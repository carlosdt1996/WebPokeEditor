//! Núcleo determinista del motor. Sin dependencias ni I/O: el host (TS) inyecta
//! input y datos, y lee el estado a través de una API C mínima (ver docs/architecture/engine-core.md).
//!
//! El estado vive en memoria lineal WASM; el host escribe/lee el mapa directamente
//! mediante `engine_tiles_ptr()` para evitar llamadas por-tile.

use core::cell::UnsafeCell;

pub const MAX_DIM: usize = 128;
pub const MOVE_TICKS: u32 = 10;

pub const T_GRASS: u8 = 0;
pub const T_TALL_GRASS: u8 = 1;
pub const T_PATH: u8 = 2;
pub const T_WATER: u8 = 3;
pub const T_TREE: u8 = 4;
pub const T_WALL: u8 = 5;
pub const T_FLOWER: u8 = 6;
pub const T_SAND: u8 = 7;

pub const IN_UP: u32 = 1;
pub const IN_DOWN: u32 = 2;
pub const IN_LEFT: u32 = 4;
pub const IN_RIGHT: u32 = 8;

pub const EV_STEP: u32 = 1;
pub const EV_ENCOUNTER: u32 = 2;
pub const EV_BLOCKED: u32 = 4;

/// Probabilidad (%) de encuentro por paso en hierba alta.
pub const ENCOUNTER_RATE: u64 = 12;

/// Direcciones: 0 abajo, 1 arriba, 2 izquierda, 3 derecha.
pub struct State {
    w: usize,
    h: usize,
    tiles: [u8; MAX_DIM * MAX_DIM],
    x: i32,
    y: i32,
    prev_x: i32,
    prev_y: i32,
    dir: u32,
    moving: u32,
    rng: u64,
    steps: u32,
}

impl State {
    pub const fn new() -> Self {
        State {
            w: 20,
            h: 15,
            tiles: [0; MAX_DIM * MAX_DIM],
            x: 0,
            y: 0,
            prev_x: 0,
            prev_y: 0,
            dir: 0,
            moving: 0,
            rng: 0x9E37_79B9_7F4A_7C15,
            steps: 0,
        }
    }

    pub fn reset(&mut self, w: usize, h: usize, seed: u64) {
        self.w = w.clamp(1, MAX_DIM);
        self.h = h.clamp(1, MAX_DIM);
        self.tiles = [0; MAX_DIM * MAX_DIM];
        self.rng = seed ^ 0x9E37_79B9_7F4A_7C15;
        if self.rng == 0 {
            self.rng = 1;
        }
        self.set_spawn(0, 0);
        self.steps = 0;
    }

    pub fn set_spawn(&mut self, x: i32, y: i32) {
        self.x = x.clamp(0, self.w as i32 - 1);
        self.y = y.clamp(0, self.h as i32 - 1);
        self.prev_x = self.x;
        self.prev_y = self.y;
        self.moving = 0;
        self.dir = 0;
    }

    pub fn tile(&self, x: i32, y: i32) -> u8 {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return T_TREE;
        }
        self.tiles[y as usize * self.w + x as usize]
    }

    pub fn set_tile(&mut self, x: i32, y: i32, t: u8) {
        if x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h {
            self.tiles[y as usize * self.w + x as usize] = t;
        }
    }

    /// xorshift64*: determinista y suficiente para el gameplay.
    pub fn next_rand(&mut self) -> u64 {
        let mut x = self.rng;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.rng = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Avanza un tick (60 Hz). Devuelve flags `EV_*`.
    pub fn tick(&mut self, input: u32) -> u32 {
        let mut ev = 0;
        if self.moving > 0 {
            self.moving -= 1;
            if self.moving == 0 {
                self.steps += 1;
                ev |= EV_STEP;
                if self.tile(self.x, self.y) == T_TALL_GRASS && self.next_rand() % 100 < ENCOUNTER_RATE {
                    ev |= EV_ENCOUNTER;
                }
            }
            return ev;
        }
        let (dir, dx, dy) = if input & IN_UP != 0 {
            (1, 0, -1)
        } else if input & IN_DOWN != 0 {
            (0, 0, 1)
        } else if input & IN_LEFT != 0 {
            (2, -1, 0)
        } else if input & IN_RIGHT != 0 {
            (3, 1, 0)
        } else {
            return 0;
        };
        self.dir = dir;
        let (nx, ny) = (self.x + dx, self.y + dy);
        if is_solid(self.tile(nx, ny)) {
            return EV_BLOCKED;
        }
        self.prev_x = self.x;
        self.prev_y = self.y;
        self.x = nx;
        self.y = ny;
        self.moving = MOVE_TICKS;
        0
    }

    /// Posición interpolada del jugador en coordenadas de tile.
    pub fn player_pos(&self) -> (f32, f32) {
        let t = self.moving as f32 / MOVE_TICKS as f32; // 1 → 0
        (
            self.x as f32 - (self.x - self.prev_x) as f32 * t,
            self.y as f32 - (self.y - self.prev_y) as f32 * t,
        )
    }
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

pub fn is_solid(t: u8) -> bool {
    matches!(t, T_WATER | T_TREE | T_WALL)
}

/// Daño Gen 3-like. `mult_x100` combina STAB y efectividad (100 = neutro);
/// `roll` ∈ [85, 100].
pub fn damage(level: u32, power: u32, atk: u32, def: u32, mult_x100: u32, roll: u32) -> u32 {
    if power == 0 || mult_x100 == 0 {
        return 0;
    }
    let def = def.max(1) as u64;
    let base = ((2 * level as u64 / 5 + 2) * power as u64 * atk as u64 / def) / 50 + 2;
    let d = base * mult_x100 as u64 / 100 * roll.clamp(85, 100) as u64 / 100;
    d.max(1) as u32
}

// ---------------------------------------------------------------------------
// API C (wasm). Estado global único: el motor es single-thread por diseño.
// ---------------------------------------------------------------------------

struct Global(UnsafeCell<State>);
// SAFETY: WASM de un solo hilo (sin atomics); cada instancia tiene su propio estado.
unsafe impl Sync for Global {}
static G: Global = Global(UnsafeCell::new(State::new()));

#[allow(clippy::mut_from_ref)]
fn st() -> &'static mut State {
    // SAFETY: ver `unsafe impl Sync`; las llamadas del host no son reentrantes.
    unsafe { &mut *G.0.get() }
}

#[no_mangle]
pub extern "C" fn engine_reset(w: u32, h: u32, seed: u32) {
    st().reset(w as usize, h as usize, seed as u64);
}
#[no_mangle]
pub extern "C" fn engine_tiles_ptr() -> *mut u8 {
    st().tiles.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn engine_width() -> u32 {
    st().w as u32
}
#[no_mangle]
pub extern "C" fn engine_height() -> u32 {
    st().h as u32
}
#[no_mangle]
pub extern "C" fn engine_set_tile(x: i32, y: i32, t: u32) {
    st().set_tile(x, y, t as u8);
}
#[no_mangle]
pub extern "C" fn engine_get_tile(x: i32, y: i32) -> u32 {
    st().tile(x, y) as u32
}
#[no_mangle]
pub extern "C" fn engine_set_spawn(x: i32, y: i32) {
    st().set_spawn(x, y);
}
#[no_mangle]
pub extern "C" fn engine_tick(input: u32) -> u32 {
    st().tick(input)
}
#[no_mangle]
pub extern "C" fn engine_player_x() -> f32 {
    st().player_pos().0
}
#[no_mangle]
pub extern "C" fn engine_player_y() -> f32 {
    st().player_pos().1
}
#[no_mangle]
pub extern "C" fn engine_player_dir() -> u32 {
    st().dir
}
#[no_mangle]
pub extern "C" fn engine_player_moving() -> u32 {
    (st().moving > 0) as u32
}
#[no_mangle]
pub extern "C" fn engine_steps() -> u32 {
    st().steps
}
#[no_mangle]
pub extern "C" fn engine_rand(max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    (st().next_rand() % max as u64) as u32
}
#[no_mangle]
pub extern "C" fn engine_is_solid(t: u32) -> u32 {
    is_solid(t as u8) as u32
}
#[no_mangle]
pub extern "C" fn engine_damage(level: u32, power: u32, atk: u32, def: u32, mult_x100: u32, roll: u32) -> u32 {
    damage(level, power, atk, def, mult_x100, roll)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(seed: u64) -> (u32, u32, i32, i32) {
        let mut s = State::new();
        s.reset(10, 10, seed);
        for y in 0..10 {
            for x in 0..10 {
                s.set_tile(x, y, T_TALL_GRASS);
            }
        }
        s.set_spawn(5, 5);
        let (mut enc, mut steps) = (0, 0);
        for i in 0..2000 {
            let input = [IN_LEFT, IN_RIGHT, IN_UP, IN_DOWN][(i / 40) % 4];
            let ev = s.tick(input);
            enc += (ev & EV_ENCOUNTER != 0) as u32;
            steps += (ev & EV_STEP != 0) as u32;
        }
        (enc, steps, s.x, s.y)
    }

    #[test]
    fn deterministic() {
        assert_eq!(run(7), run(7));
        assert_ne!(run(7).0, 0);
    }

    #[test]
    fn solid_blocks_movement() {
        let mut s = State::new();
        s.reset(5, 5, 1);
        s.set_tile(3, 2, T_WALL);
        s.set_spawn(2, 2);
        assert_eq!(s.tick(IN_RIGHT), EV_BLOCKED);
        assert_eq!((s.x, s.y), (2, 2));
        // bordes del mapa
        s.set_spawn(0, 0);
        assert_eq!(s.tick(IN_LEFT), EV_BLOCKED);
    }

    #[test]
    fn step_takes_move_ticks_and_interpolates() {
        let mut s = State::new();
        s.reset(5, 5, 1);
        s.set_spawn(1, 1);
        s.tick(IN_RIGHT);
        let (px, _) = s.player_pos();
        assert!(px < 2.0 && px >= 1.0);
        let mut ev = 0;
        for _ in 0..MOVE_TICKS {
            ev |= s.tick(0);
        }
        assert!(ev & EV_STEP != 0);
        assert_eq!(s.player_pos(), (2.0, 1.0));
    }

    #[test]
    fn damage_formula() {
        // L50, poder 40, atk 100, def 100 neutro: ((22*40*100/100)/50)+2 = 19
        assert_eq!(damage(50, 40, 100, 100, 100, 100), 19);
        assert_eq!(damage(50, 40, 100, 100, 200, 100), 38);
        assert_eq!(damage(50, 40, 100, 100, 0, 100), 0);
        assert_eq!(damage(50, 0, 100, 100, 100, 100), 0);
        assert!(damage(50, 40, 100, 100, 100, 85) < damage(50, 40, 100, 100, 100, 100));
    }
}
