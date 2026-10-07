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
pub const EV_STRIDE: usize = 17; // kind + 4 args + 8 (índice y PS por casilla) + 4 (estado por casilla)
pub const SP_STRIDE: usize = 28;
pub const MON_STRIDE: usize = 10;
pub const MV_STRIDE: usize = 14;
pub const MAX_ABILITIES: usize = 64;

// Estados (0 = ninguno)
pub const ST_BURN: i32 = 1;
pub const ST_POISON: i32 = 2;
pub const ST_PARA: i32 = 3;
pub const ST_SLEEP: i32 = 4;
pub const ST_FREEZE: i32 = 5;

// Habilidades
pub const AB_IMMUNE: i32 = 1; // a = tipo
pub const AB_ABSORB: i32 = 2; // a = tipo, b = % PS máx. que cura
pub const AB_STATUS_IMMUNE: i32 = 3; // a = estado
pub const AB_INTIMIDATE: i32 = 4;
pub const AB_PINCH: i32 = 5; // a = tipo: ×1,5 de potencia con ≤ 1/3 de PS
pub const AB_SPEED_BOOST: i32 = 6;

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
pub const A_CURE: i32 = 7; // a = objeto

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
pub const E_STATUS: i32 = 22; // a=lado, b=casilla, c=estado, d=criatura
pub const E_STAGE: i32 = 23; // a=lado, b=casilla, c=estadística (0 atk … 4 vel), d=cambio aplicado (0 = ya en el límite)
pub const E_CANT: i32 = 24; // a=lado, b=casilla, c=motivo (estado que impide actuar)
pub const E_WAKE: i32 = 25;
pub const E_THAW: i32 = 26;
pub const E_CHIP: i32 = 27; // a=lado, b=casilla, c=daño, d=estado
pub const E_DRAIN: i32 = 28; // a=lado, b=casilla, c=PS recuperados
pub const E_RECOIL: i32 = 29; // a=lado, b=casilla, c=daño
pub const E_SELFHEAL: i32 = 30; // a=lado, b=casilla, c=PS recuperados
pub const E_ABILITY: i32 = 31; // a=lado, b=casilla, c=habilidad
pub const E_IMMUNE: i32 = 32; // a=lado, b=casilla, c=habilidad
pub const E_ABSORB: i32 = 33; // a=lado, b=casilla, c=PS recuperados, d=habilidad
pub const E_CURE: i32 = 34; // a=criatura, b=objeto
pub const E_NOEFFECT: i32 = 35;

#[derive(Clone, Copy)]
struct MoveD { ty: i32, cat: i32, power: i32, acc: i32, prio: i32, st: i32, st_chance: i32, stat: i32, stages: i32, stat_foe: i32, stat_chance: i32, drain: i32, recoil: i32, heal: i32 }
#[derive(Clone, Copy)]
struct SpeciesD { t: [i32; 2], st: [i32; 6], evo_level: i32, evo_into: i32, n_learn: usize, learn: [(i32, i32); 8], ability: i32 }
#[derive(Clone, Copy)]
struct AbilityD { kind: i32, a: i32, b: i32 }
#[derive(Clone, Copy)]
pub struct Mon { pub species: i32, pub level: i32, pub hp: i32, pub exp: i32, pub nm: usize, pub moves: [i32; 4], pub status: i32 }
const NO_MON: Mon = Mon { species: 0, level: 1, hp: 0, exp: 0, nm: 0, moves: [0; 4], status: 0 };
const NO_MOVE: MoveD = MoveD { ty: 0, cat: 0, power: 0, acc: 100, prio: 0, st: 0, st_chance: 0, stat: -1, stages: 0, stat_foe: 0, stat_chance: 100, drain: 0, recoil: 0, heal: 0 };

#[derive(Clone, Copy)]
struct Unit { side: usize, slot: usize, kind: i32, a: i32, b: i32, mon: usize }

pub struct Battle {
    n_types: usize,
    chart: [[i32; MAX_TYPES]; MAX_TYPES],
    moves: [MoveD; MAX_MOVES],
    species: [SpeciesD; MAX_SPECIES],
    abilities: [AbilityD; MAX_ABILITIES],
    n_abilities: usize,
    n_species: usize,
    n_moves: usize,
    team: [[Mon; 6]; 2], // 0 jugador, 1 rival
    n: [usize; 2],
    act: [[i32; 3]; 2], // acción por casilla del jugador
    /// Volátiles del combate: modificadores de estadística (atk, def, ata.esp, def.esp, vel) y turnos de sueño.
    stages: [[[i32; 5]; 6]; 2],
    sleep: [[i32; 6]; 2],
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
            moves: [NO_MOVE; MAX_MOVES],
            species: [SpeciesD { t: [0, -1], st: [1; 6], evo_level: 0, evo_into: -1, n_learn: 0, learn: [(0, 0); 8], ability: -1 }; MAX_SPECIES],
            abilities: [AbilityD { kind: 0, a: 0, b: 0 }; MAX_ABILITIES],
            n_abilities: 0,
            n_species: 0,
            n_moves: 0,
            team: [[NO_MON; 6]; 2],
            n: [0; 2],
            act: [[A_NONE, 0, 0]; 2],
            stages: [[[0; 5]; 6]; 2],
            sleep: [[0; 6]; 2],
            active: [[-2; 2]; 2],
            size: 1,
            trainer: false,
            result: R_NONE,
            events: [0; MAX_EVENTS * EV_STRIDE],
            n_events: 0,
            io: [0; IO_LEN],
        }
    }

    /// Lee las tablas del búfer: [n_tipos, n_mov, n_esp, n_hab, tabla(n_tipos²), movimientos(14), habilidades(3), especies(28)].
    pub fn load_data(&mut self) {
        let io = &self.io;
        let mut p = 0;
        let mut next = || { let v = io[p]; p += 1; v };
        self.n_types = (next() as usize).min(MAX_TYPES);
        self.n_moves = (next() as usize).min(MAX_MOVES);
        self.n_species = (next() as usize).min(MAX_SPECIES);
        self.n_abilities = (next() as usize).min(MAX_ABILITIES);
        for i in 0..self.n_types { for j in 0..self.n_types { self.chart[i][j] = next(); } }
        for i in 0..self.n_moves {
            self.moves[i] = MoveD { ty: next(), cat: next(), power: next(), acc: next(), prio: next(), st: next(), st_chance: next(), stat: next(), stages: next(), stat_foe: next(), stat_chance: next(), drain: next(), recoil: next(), heal: next() };
        }
        for i in 0..self.n_abilities { self.abilities[i] = AbilityD { kind: next(), a: next(), b: next() }; }
        for i in 0..self.n_species {
            let t = [next(), next()];
            let st = [next(), next(), next(), next(), next(), next()];
            let (evo_level, evo_into, n_learn) = (next(), next(), (next() as usize).min(8));
            let mut learn = [(0, 0); 8];
            for k in 0..8 { learn[k] = (next(), next()); }
            let ability = next();
            self.species[i] = SpeciesD { t, st, evo_level, evo_into, n_learn, learn, ability };
        }
    }

    /// Lee un equipo del búfer: n × [especie, nivel, ps, exp, nm, m0..m3].
    pub fn load_team(&mut self, side: usize, n: usize) {
        self.n[side] = n.min(6);
        for i in 0..self.n[side] {
            let o = i * MON_STRIDE;
            let io = &self.io;
            self.team[side][i] = Mon { species: io[o], level: io[o + 1], hp: io[o + 2], exp: io[o + 3], nm: (io[o + 4] as usize).min(4), moves: [io[o + 5], io[o + 6], io[o + 7], io[o + 8]], status: io[o + 9] };
        }
    }

    pub fn write_team(&mut self, side: usize) {
        for i in 0..self.n[side] {
            let (o, m) = (i * MON_STRIDE, self.team[side][i]);
            self.io[o..o + MON_STRIDE].copy_from_slice(&[m.species, m.level, m.hp, m.exp, m.nm as i32, m.moves[0], m.moves[1], m.moves[2], m.moves[3], m.status]);
        }
    }

    pub fn start(&mut self, trainer: bool, double: bool) -> usize {
        let alive = |t: &Battle, s: usize| (0..t.n[s]).filter(|&i| t.team[s][i].hp > 0).collect::<Vec<_>>();
        let (ap, af) = (alive(self, 0), alive(self, 1));
        self.size = if double && ap.len() >= 2 && af.len() >= 2 { 2 } else { 1 };
        self.trainer = trainer;
        self.result = R_NONE;
        self.active = [[-2; 2]; 2];
        self.stages = [[[0; 5]; 6]; 2];
        self.sleep = [[0; 6]; 2];
        self.n_events = 0;
        for k in 0..self.size {
            self.active[0][k] = ap.get(k).map(|&i| i as i32).unwrap_or(-2);
            self.active[1][k] = af.get(k).map(|&i| i as i32).unwrap_or(-2);
        }
        self.act = [[A_NONE, 0, 0]; 2];
        for side in 0..2 { for k in 0..self.size { self.on_enter(side, k); } }
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

    /// Estadística efectiva en combate (k: 1 ataque … 5 velocidad): base × modificador de etapa; la parálisis reduce la velocidad a la mitad.
    fn eff_stat(&self, side: usize, idx: usize, k: usize) -> i32 {
        let m = &self.team[side][idx];
        let base = self.stat(m, k);
        let st = self.stages[side][idx][k - 1];
        let mut v = if st >= 0 { base * (2 + st) / 2 } else { base * 2 / (2 - st) };
        if k == 5 && m.status == ST_PARA { v /= 2; }
        v.max(1)
    }

    fn ability(&self, side: usize, idx: usize) -> (i32, AbilityD) {
        let ai = self.species[self.team[side][idx].species as usize].ability;
        if ai >= 0 && (ai as usize) < self.n_abilities { (ai, self.abilities[ai as usize]) } else { (-1, AbilityD { kind: 0, a: 0, b: 0 }) }
    }

    fn snapshot(&self) -> [i32; 12] {
        let mut s = [-1; 12];
        for side in 0..2 {
            for k in 0..2 {
                let i = self.active[side][k];
                s[8 + side * 2 + k] = 0;
                if i >= 0 {
                    s[side * 4 + k * 2] = i;
                    s[side * 4 + k * 2 + 1] = self.team[side][i as usize].hp;
                    s[8 + side * 2 + k] = self.team[side][i as usize].status;
                }
            }
        }
        s
    }
    fn ev(&mut self, kind: i32, a: i32, b: i32, c: i32, d: i32) {
        if self.n_events >= MAX_EVENTS { return; }
        let o = self.n_events * EV_STRIDE;
        let snap = self.snapshot();
        self.events[o..o + 5].copy_from_slice(&[kind, a, b, c, d]);
        self.events[o + 5..o + 17].copy_from_slice(&snap);
        self.n_events += 1;
    }

    fn slots(&self, side: usize) -> Vec<usize> { (0..2).filter(|&k| self.active[side][k] >= 0).collect() }
    fn reserves(&self) -> Vec<usize> { (0..self.n[0]).filter(|&i| self.team[0][i].hp > 0 && !self.active[0].contains(&(i as i32))).collect() }
    pub fn awaiting_switch(&self) -> bool { self.active[0].contains(&-1) }
    pub fn set_action(&mut self, slot: usize, kind: i32, a: i32, b: i32) { if slot < 2 { self.act[slot] = [kind, a, b]; } }

    fn first_foe(&self) -> usize { self.active[1].iter().find(|&&i| i >= 0).map(|&i| i as usize).unwrap_or(0) }

    // ----- estados, etapas y habilidades -----
    /// Cambia una etapa de estadística (−6…+6) y emite el evento con el cambio realmente aplicado.
    fn change_stage(&mut self, side: usize, slot: usize, stat: usize, delta: i32) -> bool {
        let i = self.active[side][slot];
        if i < 0 { return false; }
        let cur = self.stages[side][i as usize][stat];
        let new = (cur + delta).clamp(-6, 6);
        self.stages[side][i as usize][stat] = new;
        self.ev(E_STAGE, side as i32, slot as i32, stat as i32, new - cur);
        new != cur
    }

    /// Intenta aplicar un estado alterado. Falla si ya tiene uno o si su habilidad lo impide.
    fn apply_status(&mut self, side: usize, slot: usize, kind: i32) -> bool {
        let i = self.active[side][slot];
        if i < 0 { return false; }
        let iu = i as usize;
        if self.team[side][iu].status != 0 || self.team[side][iu].hp <= 0 { return false; }
        let (ai, ab) = self.ability(side, iu);
        if ab.kind == AB_STATUS_IMMUNE && ab.a == kind { self.ev(E_IMMUNE, side as i32, slot as i32, ai, 0); return false; }
        self.team[side][iu].status = kind;
        if kind == ST_SLEEP { self.sleep[side][iu] = 1 + Self::rnd(3) as i32; }
        self.ev(E_STATUS, side as i32, slot as i32, kind, i);
        true
    }

    /// Efectos al entrar en combate (intimidación…).
    fn on_enter(&mut self, side: usize, slot: usize) {
        let i = self.active[side][slot];
        if i < 0 { return; }
        let (ai, ab) = self.ability(side, i as usize);
        if ab.kind == AB_INTIMIDATE {
            let other = 1 - side;
            for k in self.slots(other) {
                self.ev(E_ABILITY, side as i32, slot as i32, ai, 0);
                self.change_stage(other, k, 0, -1);
            }
        }
    }

    /// ¿Puede actuar este turno? Gestiona sueño, congelación y parálisis.
    fn can_act(&mut self, side: usize, slot: usize) -> bool {
        let i = self.active[side][slot] as usize;
        let (s, sl) = (side as i32, slot as i32);
        match self.team[side][i].status {
            ST_SLEEP => {
                if self.sleep[side][i] <= 0 { self.sleep[side][i] = 1 + Self::rnd(3) as i32; }
                self.sleep[side][i] -= 1;
                if self.sleep[side][i] <= 0 { self.team[side][i].status = 0; self.ev(E_WAKE, s, sl, 0, 0); } else { self.ev(E_CANT, s, sl, ST_SLEEP, 0); }
                false
            }
            ST_FREEZE => {
                if Self::rnd(5) == 0 { self.team[side][i].status = 0; self.ev(E_THAW, s, sl, 0, 0); true } else { self.ev(E_CANT, s, sl, ST_FREEZE, 0); false }
            }
            ST_PARA => { if Self::rnd(4) == 0 { self.ev(E_CANT, s, sl, ST_PARA, 0); false } else { true } }
            _ => true,
        }
    }

    /// Daño residual de fin de turno (quemadura, veneno) y habilidades de turno.
    fn end_of_turn(&mut self) {
        for side in 0..2 {
            for slot in 0..2 {
                if self.result != R_NONE { return; }
                let i = self.active[side][slot];
                if i < 0 || self.team[side][i as usize].hp <= 0 { continue; }
                let iu = i as usize;
                let m = self.team[side][iu];
                let dmg = match m.status { ST_BURN => (self.max_hp(&m) / 16).max(1), ST_POISON => (self.max_hp(&m) / 8).max(1), _ => 0 };
                if dmg > 0 {
                    self.team[side][iu].hp = (m.hp - dmg).max(0);
                    self.ev(E_CHIP, side as i32, slot as i32, dmg, m.status);
                    if self.team[side][iu].hp <= 0 { self.faint(side, slot); continue; }
                }
                let (ai, ab) = self.ability(side, iu);
                if ab.kind == AB_SPEED_BOOST && self.stages[side][iu][4] < 6 {
                    self.ev(E_ABILITY, side as i32, slot as i32, ai, 0);
                    self.change_stage(side, slot, 4, 1);
                }
            }
        }
    }

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
        // prioridad: cambios/objetos primero (10); luego la prioridad del movimiento; luego velocidad; luego sorteo
        let prio = |b: &Battle, u: &Unit| -> i32 {
            if u.kind != A_MOVE { return 10; }
            let m = &b.team[u.side][u.mon];
            if (u.a as usize) < m.nm { let id = m.moves[u.a as usize]; if id >= 0 && (id as usize) < b.n_moves { return b.moves[id as usize].prio; } }
            0
        };
        let snapshot_b: &Battle = &*self;
        let mut order: Vec<(Unit, u32)> = units.clone();
        order.sort_by(|x, y| {
            prio(snapshot_b, &y.0).cmp(&prio(snapshot_b, &x.0))
                .then(snapshot_b.eff_stat(y.0.side, y.0.mon, 5).cmp(&snapshot_b.eff_stat(x.0.side, x.0.mon, 5)))
                .then(x.1.cmp(&y.1))
        });
        for (u, _) in order {
            if self.result != R_NONE { break; }
            let active = self.active[u.side][u.slot];
            if active < 0 || active as usize != u.mon || self.team[u.side][u.mon].hp <= 0 { continue; }
            if u.side == 0 { self.player_act(u); }
            else if u.kind == A_MOVE && self.can_act(1, u.slot) { self.attack(1, u.slot, u.a, u.b); }
        }
        if self.result == R_NONE { self.end_of_turn(); }
        self.n_events
    }

    fn player_act(&mut self, u: Unit) {
        let mon = self.team[0][u.mon];
        match u.kind {
            A_MOVE => { if (u.a as usize) < mon.nm && self.can_act(0, u.slot) { self.attack(0, u.slot, u.a, u.b); } }
            A_SWITCH => {
                let to = u.a;
                if to < 0 || to as usize >= self.n[0] || self.team[0][to as usize].hp <= 0 || self.active[0].contains(&to) { return; }
                self.ev(E_SWITCH_OUT, u.mon as i32, 0, 0, 0);
                self.stages[0][u.mon] = [0; 5];
                self.active[0][u.slot] = to;
                self.ev(E_SWITCH_IN, to, 0, 0, 0);
                self.on_enter(0, u.slot);
            }
            A_HEAL => {
                let max = self.max_hp(&mon);
                let heal = u.a.min(max - mon.hp).max(0);
                self.team[0][u.mon].hp += heal;
                self.ev(E_HEAL, u.mon as i32, heal, u.b, 0);
            }
            A_CURE => {
                if mon.status == 0 { self.ev(E_NOEFFECT, 0, 0, 0, 0); return; }
                self.team[0][u.mon].status = 0;
                self.ev(E_CURE, u.mon as i32, u.a, 0, 0);
            }
            A_BALL => {
                if self.trainer || self.size > 1 { self.ev(E_NO_CATCH, 0, 0, 0, 0); return; }
                self.ev(E_THROW, 0, 0, u.b, 0);
                let fi = self.first_foe();
                let f = self.team[1][fi];
                let max = self.max_hp(&f) as f64;
                // dormir/congelar facilita la captura
                let status_bonus = if f.status == ST_SLEEP || f.status == ST_FREEZE { 25.0 } else if f.status != 0 { 10.0 } else { 0.0 };
                let chance = (15.0 + 70.0 * (1.0 - f.hp as f64 / max) + u.a as f64 + status_bonus).min(95.0);
                if (Self::rnd(100) as f64) < chance { self.ev(E_CATCH, fi as i32, 0, 0, 0); self.result = R_CAUGHT; }
                else { self.ev(E_BALL_FAIL, 0, 0, 0, 0); }
            }
            A_RUN => {
                if self.trainer { self.ev(E_NO_RUN, 0, 0, 0, 0); return; }
                let fi = self.first_foe();
                let chance = (50 + self.eff_stat(0, u.mon, 5) - self.eff_stat(1, fi, 5)).clamp(25, 95);
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
        self.stages[0][to] = [0; 5];
        self.ev(E_FORCE_IN, to as i32, 0, 0, 0);
        self.on_enter(0, slot);
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
        self.ev(E_USE, side as i32, ai as i32, mv_id, 0);
        if (Self::rnd(100) as i32) >= mv.acc { self.ev(E_MISS, 0, 0, 0, 0); return; }

        if mv.power == 0 { self.status_move(side, slot, other, ts, &mv); return; }

        let d = self.team[other][di];
        let (dai, dab) = self.ability(other, di);
        if dab.kind == AB_IMMUNE && dab.a == mv.ty { self.ev(E_IMMUNE, other as i32, ts as i32, dai, 0); return; }
        if dab.kind == AB_ABSORB && dab.a == mv.ty {
            let heal = (self.max_hp(&d) * dab.b / 100).min(self.max_hp(&d) - d.hp).max(0);
            self.team[other][di].hp += heal;
            self.ev(E_ABSORB, other as i32, ts as i32, heal, dai);
            return;
        }
        let (asp, dsp) = (self.species[a.species as usize], self.species[d.species as usize]);
        let phys = mv.cat == 0;
        let mut atk = self.eff_stat(side, ai, if phys { 1 } else { 3 });
        if phys && a.status == ST_BURN { atk = (atk / 2).max(1); }
        let def = self.eff_stat(other, di, if phys { 2 } else { 4 });
        let mut eff = 100;
        for &t in dsp.t.iter().filter(|&&t| t >= 0) { eff = eff * self.chart[(mv.ty as usize).min(MAX_TYPES - 1)][(t as usize).min(MAX_TYPES - 1)] / 100; }
        let stab = if asp.t.contains(&mv.ty) { 150 } else { 100 };
        let crit = if Self::rnd(16) == 0 { 150 } else { 100 };
        let (_, aab) = self.ability(side, ai);
        let pinch = if aab.kind == AB_PINCH && aab.a == mv.ty && a.hp * 3 <= self.max_hp(&a) { 150 } else { 100 };
        let mult = eff * stab / 100 * crit / 100 * pinch / 100;
        let dmg = damage(a.level as u32, mv.power as u32, atk as u32, def as u32, mult as u32, 85 + Self::rnd(16)) as i32;
        self.team[other][di].hp = (d.hp - dmg).max(0);
        self.ev(E_HIT, other as i32, ts as i32, dmg, eff | if crit > 100 { 1 << 16 } else { 0 });
        let target_fainted = self.team[other][di].hp <= 0;
        if target_fainted { self.faint(other, ts); }
        if dmg > 0 {
            if mv.drain > 0 {
                let me = self.team[side][ai];
                let heal = (dmg * mv.drain / 100).max(1).min(self.max_hp(&me) - me.hp).max(0);
                if heal > 0 { self.team[side][ai].hp += heal; self.ev(E_DRAIN, side as i32, slot as i32, heal, 0); }
            }
            if mv.recoil > 0 && self.result == R_NONE {
                let r = (dmg * mv.recoil / 100).max(1);
                self.team[side][ai].hp = (self.team[side][ai].hp - r).max(0);
                self.ev(E_RECOIL, side as i32, slot as i32, r, 0);
                if self.team[side][ai].hp <= 0 { self.faint(side, slot); return; }
            }
        }
        if !target_fainted && self.result == R_NONE { self.secondary(side, slot, other, ts, &mv); }
    }

    /// Efectos secundarios de un movimiento con probabilidad (estado y cambio de estadística).
    fn secondary(&mut self, side: usize, slot: usize, other: usize, ts: usize, mv: &MoveD) -> bool {
        let mut any = false;
        if mv.st > 0 && (Self::rnd(100) as i32) < mv.st_chance { any |= self.apply_status(other, ts, mv.st); }
        if mv.stat >= 0 && mv.stages != 0 && (Self::rnd(100) as i32) < mv.stat_chance {
            let (s, k) = if mv.stat_foe != 0 { (other, ts) } else { (side, slot) };
            any |= self.change_stage(s, k, mv.stat as usize, mv.stages);
        }
        any
    }

    /// Movimientos sin daño: solo aplican sus efectos; si nada surte efecto, "¡Pero falló!".
    fn status_move(&mut self, side: usize, slot: usize, other: usize, ts: usize, mv: &MoveD) {
        let mut any = self.secondary(side, slot, other, ts, mv);
        if mv.heal > 0 {
            let ai = self.active[side][slot] as usize;
            let m = self.team[side][ai];
            let heal = (self.max_hp(&m) * mv.heal / 100).min(self.max_hp(&m) - m.hp).max(0);
            if heal > 0 { self.team[side][ai].hp += heal; self.ev(E_SELFHEAL, side as i32, slot as i32, heal, 0); any = true; }
        }
        if !any { self.ev(E_MISS, 0, 0, 0, 0); }
    }

    fn faint(&mut self, side: usize, slot: usize) {
        let mi = self.active[side][slot] as usize;
        self.ev(E_FAINT, side as i32, slot as i32, mi as i32, 0);
        self.stages[side][mi] = [0; 5];
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
                self.stages[1][n] = [0; 5];
                self.ev(E_SENDOUT, n as i32, 0, 0, 0);
                self.on_enter(1, slot);
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
#[no_mangle] pub extern "C" fn bt_event_count() -> u32 { bt().n_events as u32 }
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
        let mut v: Vec<i32> = vec![2, 2, 3, 0];
        v.extend([100, 200, 100, 100]); // tabla de tipos ×100
        for m in [[0, 0, 40, 100], [1, 1, 70, 100]] { v.extend(m); v.extend([0, 0, 0, -1, 0, 0, 100, 0, 0, 0]); } // movimientos: tipo, cat, poder, precisión + efectos
        let mut sp = |t: [i32; 2], st: [i32; 6], evo: (i32, i32), learn: &[(i32, i32)]| {
            v.extend(t); v.extend(st); v.extend([evo.0, evo.1, learn.len() as i32]);
            for k in 0..8 { let (l, m) = learn.get(k).copied().unwrap_or((0, 0)); v.extend([l, m]); }
            v.push(-1); // sin habilidad
        };
        sp([0, -1], [50, 50, 50, 50, 50, 60], (6, 2), &[(6, 1)]);
        sp([1, -1], [40, 40, 40, 40, 40, 30], (0, -1), &[]);
        sp([0, -1], [80, 80, 80, 80, 80, 80], (0, -1), &[]);
        b.io[..v.len()].copy_from_slice(&v);
        b.load_data();
    }
    fn team(b: &mut Battle, side: usize, mons: &[(i32, i32)]) {
        for (i, &(sp, lv)) in mons.iter().enumerate() {
            let m = Mon { species: sp, level: lv, hp: 0, exp: Battle::exp_for(lv), nm: 1, moves: [0, 0, 0, 0], status: 0 };
            let hp = b.max_hp(&m);
            let o = i * MON_STRIDE;
            b.io[o..o + MON_STRIDE].copy_from_slice(&[sp, lv, hp, m.exp, 1, 0, 0, 0, 0, 0]);
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

    // ----- efectos: estados, etapas, prioridad, drenaje, retroceso, curación y habilidades -----
    /// Movimientos: 0 placaje, 1 ascua (quema), 2 espora (sueño), 3 danza (+2 ataque), 4 rápido (prio +1), 5 drenaje, 6 retroceso, 7 recuperación.
    fn load_fx(b: &mut Battle) {
        let mut v: Vec<i32> = vec![2, 8, 3, 3];
        v.extend([100, 200, 100, 100]);
        // tipo, cat, poder, prec | prio, estado, prob, stat, etapas, a_rival, prob_stat, drenaje, retroceso, cura
        let fx: [[i32; 14]; 8] = [
            [0, 0, 40, 100, 0, 0, 0, -1, 0, 0, 100, 0, 0, 0],
            [1, 1, 40, 100, 0, ST_BURN, 100, -1, 0, 0, 100, 0, 0, 0],
            [0, 0, 0, 100, 0, ST_SLEEP, 100, -1, 0, 0, 100, 0, 0, 0],
            [0, 0, 0, 100, 0, 0, 0, 0, 2, 0, 100, 0, 0, 0],
            [0, 0, 40, 100, 1, 0, 0, -1, 0, 0, 100, 0, 0, 0],
            [0, 0, 40, 100, 0, 0, 0, -1, 0, 0, 100, 50, 0, 0],
            [0, 0, 100, 100, 0, 0, 0, -1, 0, 0, 100, 0, 50, 0],
            [0, 0, 0, 100, 0, 0, 0, -1, 0, 0, 100, 0, 0, 50],
        ];
        for m in fx { v.extend(m); }
        v.extend([AB_INTIMIDATE, 0, 0, AB_ABSORB, 1, 25, AB_SPEED_BOOST, 0, 0]); // habilidades 0, 1, 2
        let mut sp = |t: [i32; 2], st: [i32; 6], ab: i32| {
            v.extend(t); v.extend(st); v.extend([0, -1, 0]);
            for _ in 0..8 { v.extend([0, 0]); }
            v.push(ab);
        };
        sp([0, -1], [60, 60, 60, 60, 60, 60], -1); // 0: normal
        sp([0, -1], [60, 60, 60, 60, 60, 10], 0); // 1: lento con intimidación
        sp([1, -1], [60, 60, 60, 60, 60, 20], 1); // 2: tipo 1 con absorción
        b.io[..v.len()].copy_from_slice(&v);
        b.load_data();
    }
    fn fx_battle(seed: u32, mine: (i32, i32), foe: (i32, i32), moves: [i32; 2]) -> Battle {
        crate::engine_reset(8, 8, seed);
        let mut b = Battle::new();
        load_fx(&mut b);
        for (side, (sp, lv)) in [(0usize, mine), (1usize, foe)] {
            // el rival siempre usa placaje (0); así el comportamiento del rival no interfiere con lo que se prueba
            let mv = if side == 0 { moves } else { [0, 0] };
            let m = Mon { species: sp, level: lv, hp: 0, exp: Battle::exp_for(lv), nm: 2, moves: [mv[0], mv[1], 0, 0], status: 0 };
            let hp = b.max_hp(&m);
            b.io[..MON_STRIDE].copy_from_slice(&[sp, lv, hp, m.exp, 2, mv[0], mv[1], 0, 0, 0]);
            b.load_team(side, 1);
        }
        b
    }
    fn kinds(b: &Battle, n: usize) -> Vec<i32> { (0..n).map(|i| b.events[i * EV_STRIDE]).collect() }

    #[test]
    fn burn_status_and_chip_damage() {
        let mut b = fx_battle(2, (0, 30), (0, 30), [1, 0]);
        b.start(true, false);
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_STATUS));
        assert_eq!(b.team[1][0].status, ST_BURN);
        assert!(kinds(&b, n).contains(&E_CHIP), "la quemadura hace daño residual");
    }

    #[test]
    fn sleep_skips_turns_then_wakes() {
        let mut b = fx_battle(5, (0, 30), (0, 30), [2, 0]);
        b.start(true, false);
        let mut seen = vec![];
        for _ in 0..6 {
            let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
            seen.extend(kinds(&b, n));
            if b.team[1][0].status == 0 && seen.contains(&E_WAKE) { break; }
        }
        assert!(seen.contains(&E_STATUS) && seen.contains(&E_CANT) | seen.contains(&E_WAKE));
        assert!(seen.contains(&E_WAKE), "el dormido acaba despertando");
    }

    #[test]
    fn stat_stages_boost_and_cap() {
        let mut b = fx_battle(3, (0, 30), (0, 30), [3, 0]);
        b.team[1][0].moves = [3, 3, 0, 0]; // el rival solo sube su propio ataque: nadie se debilita durante la prueba
        b.start(true, false);
        for _ in 0..4 { b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]); }
        assert_eq!(b.stages[0][0][0], 6, "las etapas se limitan a +6");
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        let stage_d = (0..n).find(|&i| b.events[i * EV_STRIDE] == E_STAGE).map(|i| b.events[i * EV_STRIDE + 4]);
        assert_eq!(stage_d, Some(0), "en el límite el cambio aplicado es 0");
    }

    #[test]
    fn priority_beats_speed_and_drain_recoil_heal() {
        // mi criatura es más lenta pero usa un movimiento de prioridad
        let mut b = fx_battle(7, (1, 30), (0, 30), [4, 0]);
        b.start(true, false);
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        let first_user = (0..n).find(|&i| b.events[i * EV_STRIDE] == E_USE).map(|i| b.events[i * EV_STRIDE + 1]);
        assert_eq!(first_user, Some(0), "la prioridad +1 actúa antes que el más rápido");
        let mut b = fx_battle(8, (0, 30), (0, 30), [5, 7]);
        b.start(true, false);
        b.team[0][0].hp = 20;
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_DRAIN));
        let mut b = fx_battle(9, (0, 30), (0, 30), [6, 7]);
        b.start(true, false);
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_RECOIL));
        // nivel mayor ⇒ más rápido y con margen de PS: cura antes de que el rival pueda debilitarlo
        let mut b = fx_battle(10, (0, 50), (0, 30), [7, 0]);
        b.start(true, false);
        b.team[0][0].hp = 20;
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_SELFHEAL));
        // curar con la vida llena falla
        let mut b = fx_battle(11, (0, 30), (0, 30), [7, 0]);
        b.start(true, false);
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(!kinds(&b, n).contains(&E_SELFHEAL));
    }

    #[test]
    fn abilities_intimidate_absorb_and_speed_boost() {
        // intimidación al entrar: el rival pierde 1 de ataque nada más empezar
        let mut b = fx_battle(12, (1, 30), (0, 30), [0, 0]);
        let _ = b.start(true, false);
        assert_eq!(b.stages[1][0][0], -1);
        assert!(kinds(&b, b.n_events).contains(&E_ABILITY));
        // absorción: un movimiento del tipo 1 cura en vez de dañar
        let mut b = fx_battle(13, (0, 30), (2, 30), [1, 0]);
        b.start(true, false);
        b.team[1][0].hp = 20;
        let n = b.turn([[A_MOVE, 0, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_ABSORB));
        assert!(b.team[1][0].hp > 20);
        // cura de estado
        let mut b = fx_battle(14, (0, 30), (0, 30), [0, 0]);
        b.start(true, false);
        b.team[0][0].status = ST_POISON;
        let n = b.turn([[A_CURE, 3, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_CURE) && b.team[0][0].status == 0);
        let n = b.turn([[A_CURE, 3, 0], [A_NONE, 0, 0]]);
        assert!(kinds(&b, n).contains(&E_NOEFFECT));
    }
}
