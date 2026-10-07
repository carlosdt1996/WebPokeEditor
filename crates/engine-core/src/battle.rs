//! Simulación de combate por turnos (1v1 y 2v2), determinista y sin I/O.
//!
//! El host carga las tablas de datos (tipos, movimientos, especies) y los equipos a través de un
//! búfer de enteros compartido, envía las acciones del turno y lee de vuelta una lista de eventos
//! (cada uno con una instantánea de los PS en pantalla). El texto lo genera el host.

use core::cell::UnsafeCell;

use crate::{damage, engine_rand};

pub const MAX_TYPES: usize = 16;
pub const MAX_MOVES: usize = 256;
pub const MAX_SPECIES: usize = 128;
pub const IO_LEN: usize = 8192;
pub const MAX_EVENTS: usize = 256;
pub const EV_STRIDE: usize = 13; // kind + 4 args + 8 de instantánea
pub const SP_STRIDE: usize = 27;
pub const MON_STRIDE: usize = 9;

// Resultado
pub const R_NONE: i32 = 0;
pub const R_WIN: i32 = 1;
pub const R_LOSE: i32 = 2;
pub const R_RUN: i32 = 3;
pub const R_CAUGHT: i32 = 4;

// Acciones
pub const A_NONE: i32 = 0;
pub const A_MOVE: i32 = 1; // a = índice de movimiento, b = casilla objetivo
pub const A_SWITCH: i32 = 2; // a = criatura del equipo
pub const A_HEAL: i32 = 3; // a = PS, b = id de objeto
pub const A_BALL: i32 = 4; // a = bonus %, b = id de objeto
pub const A_RUN: i32 = 5;
pub const A_NOITEM: i32 = 6;

// Eventos (args a, b, c, d)
pub const E_USE: i32 = 1; // a=lado, b=criatura, c=movimiento
pub const E_MISS: i32 = 2;
pub const E_HIT: i32 = 3; // a=lado objetivo, b=casilla, c=daño, d=efectividad×100 | crítico<<16
pub const E_FAINT: i32 = 4; // a=lado, b=casilla, c=criatura
pub const E_EXP: i32 = 5; // a=criatura, b=ganancia
pub const E_LEVEL: i32 = 6; // a=criatura, b=nivel
pub const E_LEARN: i32 = 7; // a=criatura, b=movimiento
pub const E_EVOLVE: i32 = 8; // a=criatura, b=especie antigua, c=nueva
pub const E_SENDOUT: i32 = 9; // a=criatura rival
pub const E_SWITCH_OUT: i32 = 10; // a=criatura
pub const E_SWITCH_IN: i32 = 11; // a=criatura
pub const E_HEAL: i32 = 12; // a=criatura, b=PS curados, c=objeto
pub const E_NOITEM: i32 = 13;
pub const E_THROW: i32 = 14; // c=objeto
pub const E_CATCH: i32 = 15; // a=criatura rival
pub const E_BALL_FAIL: i32 = 16;
pub const E_RUN_OK: i32 = 17;
pub const E_RUN_FAIL: i32 = 18;
pub const E_NO_RUN: i32 = 19;
pub const E_NO_CATCH: i32 = 20;
pub const E_FORCE_IN: i32 = 21; // a=criatura

#[derive(Clone, Copy)]
struct MoveD { ty: i32, cat: i32, power: i32, acc: i32 }
#[derive(Clone, Copy)]
struct SpeciesD { t: [i32; 2], st: [i32; 6], evo_level: i32, evo_into: i32, n_learn: usize, learn: [(i32, i32); 8] }
#[derive(Clone, Copy)]
pub struct Mon { pub species: i32, pub level: i32, pub hp: i32, pub exp: i32, pub nm: usize, pub moves: [i32; 4] }
const NO_MON: Mon = Mon { species: 0, level: 1, hp: 0, exp: 0, nm: 0, moves: [0; 4] };

#[derive(Clone, Copy)]
struct Unit { side: usize, slot: usize, kind: i32, a: i32, b: i32, mon: usize }

pub struct Battle {
    n_types: usize,
    chart: [[i32; MAX_TYPES]; MAX_TYPES],
    moves: [MoveD; MAX_MOVES],
    species: [SpeciesD; MAX_SPECIES],
    n_species: usize,
    n_moves: usize,
    team: [[Mon; 6]; 2], // 0 jugador, 1 rival
    n: [usize; 2],
    act: [[i32; 3]; 2], // acción por casilla del jugador
    /// Casillas activas: índice en el equipo, -1 = a reemplazar, -2 = vacía.
    active: [[i32; 2]; 2],
    size: usize,
    trainer: bool,
    result: i32,
    events: [i32; MAX_EVENTS * EV_STRIDE],
    n_events: usize,
    pub io: [i32; IO_LEN],
}

impl Battle {
    pub const fn new() -> Self {
        Battle {
            n_types: 0,
            chart: [[100; MAX_TYPES]; MAX_TYPES],
            moves: [MoveD { ty: 0, cat: 0, power: 0, acc: 100 }; MAX_MOVES],
            species: [SpeciesD { t: [0, -1], st: [1; 6], evo_level: 0, evo_into: -1, n_learn: 0, learn: [(0, 0); 8] }; MAX_SPECIES],
            n_species: 0,
            n_moves: 0,
            team: [[NO_MON; 6]; 2],
            n: [0; 2],
            act: [[A_NONE, 0, 0]; 2],
            active: [[-2; 2]; 2],
            size: 1,
            trainer: false,
            result: R_NONE,
            events: [0; MAX_EVENTS * EV_STRIDE],
            n_events: 0,
            io: [0; IO_LEN],
        }
    }

    /// Lee las tablas del búfer: [n_tipos, n_mov, n_esp, tabla(n_tipos²), movimientos(4), especies(27)].
    pub fn load_data(&mut self) {
        let io = &self.io;
        let mut p = 0;
        let mut next = || { let v = io[p]; p += 1; v };
        self.n_types = (next() as usize).min(MAX_TYPES);
        self.n_moves = (next() as usize).min(MAX_MOVES);
        self.n_species = (next() as usize).min(MAX_SPECIES);
        for i in 0..self.n_types { for j in 0..self.n_types { self.chart[i][j] = next(); } }
        for i in 0..self.n_moves { self.moves[i] = MoveD { ty: next(), cat: next(), power: next(), acc: next() }; }
        for i in 0..self.n_species {
            let t = [next(), next()];
            let st = [next(), next(), next(), next(), next(), next()];
            let (evo_level, evo_into, n_learn) = (next(), next(), (next() as usize).min(8));
            let mut learn = [(0, 0); 8];
            for k in 0..8 { learn[k] = (next(), next()); }
            self.species[i] = SpeciesD { t, st, evo_level, evo_into, n_learn, learn };
        }
    }

    /// Lee un equipo del búfer: n × [especie, nivel, ps, exp, nm, m0..m3].
    pub fn load_team(&mut self, side: usize, n: usize) {
        self.n[side] = n.min(6);
        for i in 0..self.n[side] {
            let o = i * MON_STRIDE;
            let io = &self.io;
            self.team[side][i] = Mon { species: io[o], level: io[o + 1], hp: io[o + 2], exp: io[o + 3], nm: (io[o + 4] as usize).min(4), moves: [io[o + 5], io[o + 6], io[o + 7], io[o + 8]] };
        }
    }

    pub fn write_team(&mut self, side: usize) {
        for i in 0..self.n[side] {
            let (o, m) = (i * MON_STRIDE, self.team[side][i]);
            self.io[o..o + MON_STRIDE].copy_from_slice(&[m.species, m.level, m.hp, m.exp, m.nm as i32, m.moves[0], m.moves[1], m.moves[2], m.moves[3]]);
        }
    }

    pub fn start(&mut self, trainer: bool, double: bool) -> usize {
        let alive = |t: &Battle, s: usize| (0..t.n[s]).filter(|&i| t.team[s][i].hp > 0).collect::<Vec<_>>();
        let (ap, af) = (alive(self, 0), alive(self, 1));
        self.size = if double && ap.len() >= 2 && af.len() >= 2 { 2 } else { 1 };
        self.trainer = trainer;
        self.result = R_NONE;
        self.active = [[-2; 2]; 2];
        for k in 0..self.size {
            self.active[0][k] = ap.get(k).map(|&i| i as i32).unwrap_or(-2);
            self.active[1][k] = af.get(k).map(|&i| i as i32).unwrap_or(-2);
        }
        self.act = [[A_NONE, 0, 0]; 2];
        self.size
    }

    pub fn write_state(&mut self) {
        let s = [self.size as i32, self.result, self.active[0][0], self.active[0][1], self.active[1][0], self.active[1][1], self.n[0] as i32, self.n[1] as i32];
        self.io[..8].copy_from_slice(&s);
    }

    // ----- utilidades -----
    fn max_hp(&self, m: &Mon) -> i32 { 2 * self.species[m.species as usize].st[0] * m.level / 100 + m.level + 10 }
    fn stat(&self, m: &Mon, k: usize) -> i32 { 2 * self.species[m.species as usize].st[k] * m.level / 100 + 5 }
    fn exp_for(level: i32) -> i32 { level * level * 2 }
    fn rnd(n: u32) -> u32 { engine_rand(n) }

    fn snapshot(&self) -> [i32; 8] {
        let mut s = [-1; 8];
        for side in 0..2 {
            for k in 0..2 {
                let i = self.active[side][k];
                if i >= 0 { s[side * 4 + k * 2] = i; s[side * 4 + k * 2 + 1] = self.team[side][i as usize].hp; }
            }
        }
        s
    }
    fn ev(&mut self, kind: i32, a: i32, b: i32, c: i32, d: i32) {
        if self.n_events >= MAX_EVENTS { return; }
        let o = self.n_events * EV_STRIDE;
        let snap = self.snapshot();
        self.events[o..o + 5].copy_from_slice(&[kind, a, b, c, d]);
        self.events[o + 5..o + 13].copy_from_slice(&snap);
        self.n_events += 1;
    }

    fn slots(&self, side: usize) -> Vec<usize> { (0..2).filter(|&k| self.active[side][k] >= 0).collect() }
    fn reserves(&self) -> Vec<usize> { (0..self.n[0]).filter(|&i| self.team[0][i].hp > 0 && !self.active[0].contains(&(i as i32))).collect() }
    pub fn awaiting_switch(&self) -> bool { self.active[0].contains(&-1) }
    pub fn set_action(&mut self, slot: usize, kind: i32, a: i32, b: i32) { if slot < 2 { self.act[slot] = [kind, a, b]; } }

    fn first_foe(&self) -> usize { self.active[1].iter().find(|&&i| i >= 0).map(|&i| i as usize).unwrap_or(0) }

    // ----- turno -----
    pub fn turn(&mut self, acts: [[i32; 3]; 2]) -> usize {
        self.n_events = 0;
        if self.result != R_NONE || self.awaiting_switch() { return 0; }
        let mut units: Vec<(Unit, u32)> = Vec::new();
        for k in 0..2 {
            let pi = self.active[0][k];
            if pi >= 0 && acts[k][0] != A_NONE { units.push((Unit { side: 0, slot: k, kind: acts[k][0], a: acts[k][1], b: acts[k][2], mon: pi as usize }, 0)); }
        }
        for k in 0..2 {
            let fi = self.active[1][k];
            if fi < 0 { continue; }
            let m = self.team[1][fi as usize];
            let mv = Self::rnd(m.nm as u32) as i32;
            let alive = self.slots(0);
            let target = if alive.is_empty() { 0 } else { alive[Self::rnd(alive.len() as u32) as usize] as i32 };
            units.push((Unit { side: 1, slot: k, kind: A_MOVE, a: mv, b: target, mon: fi as usize }, 0));
        }
        for u in units.iter_mut() { u.1 = Self::rnd(1000); }
        let prio = |u: &Unit| if u.kind == A_MOVE { 0 } else { 1 };
        let spd = |b: &Battle, u: &Unit| b.stat(&b.team[u.side][u.mon], 5);
        let snapshot_b: &Battle = &*self;
        let mut order: Vec<(Unit, u32)> = units.clone();
        order.sort_by(|x, y| {
            prio(&y.0).cmp(&prio(&x.0))
                .then(spd(snapshot_b, &y.0).cmp(&spd(snapshot_b, &x.0)))
                .then(x.1.cmp(&y.1))
        });
        for (u, _) in order {
            if self.result != R_NONE { break; }
            let active = self.active[u.side][u.slot];
            if active < 0 || active as usize != u.mon || self.team[u.side][u.mon].hp <= 0 { continue; }
            if u.side == 0 { self.player_act(u); } else if u.kind == A_MOVE { self.attack(1, u.slot, u.a, u.b); }
        }
        self.n_events
    }

    fn player_act(&mut self, u: Unit) {
        let mon = self.team[0][u.mon];
        match u.kind {
            A_MOVE => { if (u.a as usize) < mon.nm { self.attack(0, u.slot, u.a, u.b); } }
            A_SWITCH => {
                let to = u.a;
                if to < 0 || to as usize >= self.n[0] || self.team[0][to as usize].hp <= 0 || self.active[0].contains(&to) { return; }
                self.ev(E_SWITCH_OUT, u.mon as i32, 0, 0, 0);
                self.active[0][u.slot] = to;
                self.ev(E_SWITCH_IN, to, 0, 0, 0);
            }
            A_HEAL => {
                let max = self.max_hp(&mon);
                let heal = u.a.min(max - mon.hp).max(0);
                self.team[0][u.mon].hp += heal;
                self.ev(E_HEAL, u.mon as i32, heal, u.b, 0);
            }
            A_BALL => {
                if self.trainer || self.size > 1 { self.ev(E_NO_CATCH, 0, 0, 0, 0); return; }
                self.ev(E_THROW, 0, 0, u.b, 0);
                let fi = self.first_foe();
                let f = self.team[1][fi];
                let max = self.max_hp(&f) as f64;
                let chance = (15.0 + 70.0 * (1.0 - f.hp as f64 / max) + u.a as f64).min(95.0);
                if (Self::rnd(100) as f64) < chance { self.ev(E_CATCH, fi as i32, 0, 0, 0); self.result = R_CAUGHT; }
                else { self.ev(E_BALL_FAIL, 0, 0, 0, 0); }
            }
            A_RUN => {
                if self.trainer { self.ev(E_NO_RUN, 0, 0, 0, 0); return; }
                let foe = self.team[1][self.first_foe()];
                let chance = (50 + self.stat(&mon, 5) - self.stat(&foe, 5)).clamp(25, 95);
                if (Self::rnd(100) as i32) < chance { self.ev(E_RUN_OK, 0, 0, 0, 0); self.result = R_RUN; } else { self.ev(E_RUN_FAIL, 0, 0, 0, 0); }
            }
            A_NOITEM => self.ev(E_NOITEM, 0, 0, 0, 0),
            _ => {}
        }
    }

    /// Reemplazo obligatorio de una casilla.
    pub fn force_switch(&mut self, slot: usize, to: usize) -> usize {
        self.n_events = 0;
        if slot > 1 || self.active[0][slot] != -1 || to >= self.n[0] || self.team[0][to].hp <= 0 || self.active[0].contains(&(to as i32)) { return 0; }
        self.active[0][slot] = to as i32;
        self.ev(E_FORCE_IN, to as i32, 0, 0, 0);
        self.n_events
    }

    fn attack(&mut self, side: usize, slot: usize, mv_idx: i32, target_slot: i32) {
        let other = 1 - side;
        let ai = self.active[side][slot] as usize;
        let a = self.team[side][ai];
        let mv_id = a.moves[(mv_idx as usize).min(3)];
        if mv_id < 0 || mv_id as usize >= self.n_moves { return; }
        let mv = self.moves[mv_id as usize];
        // objetivo: el elegido si sigue en pie; si no, el primero en pie
        let alive_at = |b: &Battle, k: i32| k >= 0 && (k as usize) < 2 && b.active[other][k as usize] >= 0 && b.team[other][b.active[other][k as usize] as usize].hp > 0;
        let ts = if alive_at(self, target_slot) { target_slot as usize } else if let Some(k) = (0..2).find(|&k| alive_at(self, k as i32)) { k } else { return };
        let di = self.active[other][ts] as usize;
        let d = self.team[other][di];
        self.ev(E_USE, side as i32, ai as i32, mv_id, 0);
        if (Self::rnd(100) as i32) >= mv.acc { self.ev(E_MISS, 0, 0, 0, 0); return; }
        let (asp, dsp) = (self.species[a.species as usize], self.species[d.species as usize]);
        let phys = mv.cat == 0;
        let atk = self.stat(&a, if phys { 1 } else { 3 });
        let def = self.stat(&d, if phys { 2 } else { 4 });
        let mut eff = 100;
        for &t in dsp.t.iter().filter(|&&t| t >= 0) { eff = eff * self.chart[(mv.ty as usize).min(MAX_TYPES - 1)][(t as usize).min(MAX_TYPES - 1)] / 100; }
        let stab = if asp.t.contains(&mv.ty) { 150 } else { 100 };
        let crit = if Self::rnd(16) == 0 { 150 } else { 100 };
        let mult = eff * stab / 100 * crit / 100;
        let dmg = damage(a.level as u32, mv.power as u32, atk as u32, def as u32, mult as u32, 85 + Self::rnd(16)) as i32;
        self.team[other][di].hp = (d.hp - dmg).max(0);
        self.ev(E_HIT, other as i32, ts as i32, dmg, eff | if crit > 100 { 1 << 16 } else { 0 });
        if self.team[other][di].hp <= 0 { self.faint(other, ts); }
    }

    fn faint(&mut self, side: usize, slot: usize) {
        let mi = self.active[side][slot] as usize;
        self.ev(E_FAINT, side as i32, slot as i32, mi as i32, 0);
        if side == 1 {
            let f = self.team[1][mi];
            let gain = if self.trainer { f.level * 9 } else { f.level * 6 } + 10;
            for k in 0..2 {
                let pi = self.active[0][k];
                if pi >= 0 && self.team[0][pi as usize].hp > 0 { self.gain_exp(pi as usize, gain); }
            }
            let next = (0..self.n[1]).find(|&i| self.team[1][i].hp > 0 && !self.active[1].contains(&(i as i32)));
            if let (true, Some(n)) = (self.trainer, next) {
                self.active[1][slot] = n as i32;
                self.ev(E_SENDOUT, n as i32, 0, 0, 0);
            } else {
                self.active[1][slot] = -2;
                if !(0..self.n[1]).any(|i| self.team[1][i].hp > 0) { self.result = R_WIN; }
            }
        } else if !self.reserves().is_empty() {
            self.active[0][slot] = -1;
        } else {
            self.active[0][slot] = -2;
            if !(0..self.n[0]).any(|i| self.team[0][i].hp > 0) { self.result = R_LOSE; }
        }
    }

    fn gain_exp(&mut self, pi: usize, gain: i32) {
        self.team[0][pi].exp += gain;
        self.ev(E_EXP, pi as i32, gain, 0, 0);
        loop {
            let m = self.team[0][pi];
            if m.exp < Self::exp_for(m.level + 1) || m.level >= 100 { break; }
            let before = self.max_hp(&m);
            self.team[0][pi].level += 1;
            let after = self.max_hp(&self.team[0][pi]);
            self.team[0][pi].hp += after - before;
            let lvl = self.team[0][pi].level;
            self.ev(E_LEVEL, pi as i32, lvl, 0, 0);
            let sp = self.species[self.team[0][pi].species as usize];
            for k in 0..sp.n_learn {
                let (l, mv) = sp.learn[k];
                let cur = self.team[0][pi];
                if l != lvl || cur.moves[..cur.nm].contains(&mv) { continue; }
                let t = &mut self.team[0][pi];
                if t.nm >= 4 { t.moves.copy_within(1..4, 0); t.moves[3] = mv; } else { t.moves[t.nm] = mv; t.nm += 1; }
                self.ev(E_LEARN, pi as i32, mv, 0, 0);
            }
            if sp.evo_level > 0 && lvl >= sp.evo_level && sp.evo_into >= 0 && (sp.evo_into as usize) < self.n_species {
                let (old, b4) = (self.team[0][pi].species, self.max_hp(&self.team[0][pi]));
                self.team[0][pi].species = sp.evo_into;
                let a4 = self.max_hp(&self.team[0][pi]);
                self.team[0][pi].hp += a4 - b4;
                self.ev(E_EVOLVE, pi as i32, old, sp.evo_into, 0);
            }
        }
    }

    pub fn event_ptr(&self) -> *const i32 { self.events.as_ptr() }
}

struct GlobalB(UnsafeCell<Battle>);
// SAFETY: WASM de un solo hilo, como el resto del estado global.
unsafe impl Sync for GlobalB {}
static B: GlobalB = GlobalB(UnsafeCell::new(Battle::new()));
#[allow(clippy::mut_from_ref)]
fn bt() -> &'static mut Battle {
    // SAFETY: ver `unsafe impl Sync`; las llamadas del host no son reentrantes.
    unsafe { &mut *B.0.get() }
}

#[no_mangle] pub extern "C" fn bt_io_ptr() -> *mut i32 { bt().io.as_mut_ptr() }
#[no_mangle] pub extern "C" fn bt_events_ptr() -> *const i32 { bt().event_ptr() }
#[no_mangle] pub extern "C" fn bt_load_data() { bt().load_data(); }
#[no_mangle] pub extern "C" fn bt_load_team(side: u32, n: u32) { bt().load_team((side as usize).min(1), n as usize); }
#[no_mangle] pub extern "C" fn bt_read_team(side: u32) { bt().write_team((side as usize).min(1)); }
#[no_mangle] pub extern "C" fn bt_start(trainer: u32, double: u32) -> u32 { bt().start(trainer != 0, double != 0) as u32 }
#[no_mangle] pub extern "C" fn bt_state() { bt().write_state(); }
#[no_mangle] pub extern "C" fn bt_set_action(slot: u32, kind: i32, a: i32, b: i32) { bt().set_action(slot as usize, kind, a, b); }
#[no_mangle] pub extern "C" fn bt_turn() -> u32 {
    let b = bt();
    let acts = b.act;
    b.act = [[A_NONE, 0, 0]; 2];
    b.turn(acts) as u32
}
#[no_mangle] pub extern "C" fn bt_force_switch(slot: u32, to: u32) -> u32 { bt().force_switch(slot as usize, to as usize) as u32 }

#[cfg(test)]
mod tests {
    use super::*;

    /// 2 tipos (el 0 es fuerte contra el 1), 2 movimientos y 3 especies; la 0 evoluciona a la 2 en el nivel 6.
    fn load(b: &mut Battle) {
        let mut v: Vec<i32> = vec![2, 2, 3];
        v.extend([100, 200, 100, 100]); // tabla de tipos ×100
        v.extend([0, 0, 40, 100, 1, 1, 70, 100]); // movimientos: tipo, cat, poder, precisión
        let mut sp = |t: [i32; 2], st: [i32; 6], evo: (i32, i32), learn: &[(i32, i32)]| {
            v.extend(t); v.extend(st); v.extend([evo.0, evo.1, learn.len() as i32]);
            for k in 0..8 { let (l, m) = learn.get(k).copied().unwrap_or((0, 0)); v.extend([l, m]); }
        };
        sp([0, -1], [50, 50, 50, 50, 50, 60], (6, 2), &[(6, 1)]);
        sp([1, -1], [40, 40, 40, 40, 40, 30], (0, -1), &[]);
        sp([0, -1], [80, 80, 80, 80, 80, 80], (0, -1), &[]);
        b.io[..v.len()].copy_from_slice(&v);
        b.load_data();
    }
    fn team(b: &mut Battle, side: usize, mons: &[(i32, i32)]) {
        for (i, &(sp, lv)) in mons.iter().enumerate() {
            let m = Mon { species: sp, level: lv, hp: 0, exp: Battle::exp_for(lv), nm: 1, moves: [0, 0, 0, 0] };
            let hp = b.max_hp(&m);
            let o = i * MON_STRIDE;
            b.io[o..o + 9].copy_from_slice(&[sp, lv, hp, m.exp, 1, 0, 0, 0, 0]);
        }
        b.load_team(side, mons.len());
    }
    fn fight(seed: u32, double: bool) -> (i32, Vec<i32>) {
        crate::engine_reset(8, 8, seed);
        let mut b = Battle::new();
        load(&mut b);
        team(&mut b, 0, &[(0, 20), (0, 20)]);
        team(&mut b, 1, &[(1, 6), (1, 6)]);
        b.start(true, double);
        let mut kinds = vec![];
        for _ in 0..60 {
            if b.result != R_NONE { break; }
            let n = b.turn([[A_MOVE, 0, 0], [A_MOVE, 0, 1]]);
            for i in 0..n { kinds.push(b.events[i * EV_STRIDE]); }
            if b.awaiting_switch() { for k in 0..2 { if b.active[0][k] == -1 { let r = b.reserves()[0]; b.force_switch(k, r); } } }
        }
        (b.result, kinds)
    }

    #[test]
    fn battles_finish_and_are_deterministic() {
        for double in [false, true] {
            let (r1, k1) = fight(3, double);
            let (r2, k2) = fight(3, double);
            assert_eq!(r1, R_WIN);
            assert_eq!((r1, &k1), (r2, &k2));
            assert!(k1.contains(&E_HIT) && k1.contains(&E_FAINT) && k1.contains(&E_EXP));
        }
    }

    #[test]
    fn double_needs_two_alive_each_side() {
        crate::engine_reset(8, 8, 1);
        let mut b = Battle::new();
        load(&mut b);
        team(&mut b, 0, &[(0, 5)]);
        team(&mut b, 1, &[(1, 5), (1, 5)]);
        assert_eq!(b.start(true, true), 1);
        team(&mut b, 0, &[(0, 5), (0, 5)]);
        assert_eq!(b.start(true, true), 2);
    }

    #[test]
    fn level_up_learns_and_evolves() {
        crate::engine_reset(8, 8, 9);
        let mut b = Battle::new();
        load(&mut b);
        team(&mut b, 0, &[(0, 5)]);
        b.team[0][0].exp = Battle::exp_for(6) - 1;
        team(&mut b, 1, &[(1, 3)]);
        b.team[1][0].hp = 1;
        b.start(false, false);
        let mut kinds = vec![];
        for _ in 0..20 {
            if b.result != R_NONE { break; }
            let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
            for i in 0..n { kinds.push(b.events[i * EV_STRIDE]); }
        }
        assert_eq!(b.result, R_WIN);
        assert!(kinds.contains(&E_LEVEL) && kinds.contains(&E_LEARN) && kinds.contains(&E_EVOLVE));
        assert_eq!(b.team[0][0].species, 2);
        assert_eq!(b.team[0][0].nm, 2);
    }

    #[test]
    fn items_run_and_catch() {
        crate::engine_reset(8, 8, 4);
        let mut b = Battle::new();
        load(&mut b);
        team(&mut b, 0, &[(0, 30)]);
        team(&mut b, 1, &[(1, 3)]);
        b.team[1][0].hp = 1;
        b.start(false, false);
        b.team[0][0].hp = 5;
        b.turn([[A_HEAL, 20, 7], [A_NONE, 0, 0]]);
        assert!(b.team[0][0].hp > 5);
        for _ in 0..40 { if b.result != R_NONE { break; } b.turn([[A_BALL, 0, 1], [A_NONE, 0, 0]]); }
        assert_eq!(b.result, R_CAUGHT);
        // contra entrenador: no se huye ni se captura
        team(&mut b, 1, &[(1, 3)]);
        b.start(true, false);
        b.turn([[A_RUN, 0, 0], [A_NONE, 0, 0]]);
        assert_eq!(b.result, R_NONE);
        b.turn([[A_BALL, 0, 0], [A_NONE, 0, 0]]);
        assert_eq!(b.result, R_NONE);
    }
}
