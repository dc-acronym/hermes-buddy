//! Window-shake detection. Pure and clock-free: feed it `(Instant, x, y)` samples in
//! **logical** pixels and it says when the user has grabbed the window and shaken it.
//!
//! A shake is >= [`MIN_REVERSALS`] direction reversals on the dominant axis inside the last
//! [`WINDOW`], where every swing is at least [`MIN_SWING`] logical px. After firing there is a
//! [`COOLDOWN`] during which samples are ignored.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub const WINDOW: Duration = Duration::from_millis(700);
pub const COOLDOWN: Duration = Duration::from_secs(2);
pub const MIN_SWING: f64 = 12.0;
pub const MIN_REVERSALS: u32 = 3;

#[derive(Debug, Clone, Copy)]
struct Sample {
    t: Instant,
    x: f64,
    y: f64,
}

#[derive(Debug, Default)]
pub struct ShakeDetector {
    samples: VecDeque<Sample>,
    last_fired: Option<Instant>,
}

impl ShakeDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one position sample (logical px). Returns `true` exactly when a shake is recognised.
    pub fn feed(&mut self, t: Instant, x: f64, y: f64) -> bool {
        if let Some(fired) = self.last_fired {
            if t.saturating_duration_since(fired) < COOLDOWN {
                return false;
            }
            self.last_fired = None;
        }

        self.samples.push_back(Sample { t, x, y });
        while self
            .samples
            .front()
            .is_some_and(|s| t.saturating_duration_since(s.t) > WINDOW)
        {
            self.samples.pop_front();
        }

        if self.reversals() >= MIN_REVERSALS {
            self.samples.clear();
            self.last_fired = Some(t);
            return true;
        }
        false
    }

    /// Reversals on the axis that moved the most (by total path length) within the window.
    fn reversals(&self) -> u32 {
        if self.samples.len() < 2 {
            return 0;
        }
        let (mut path_x, mut path_y) = (0.0, 0.0);
        for (a, b) in self.samples.iter().zip(self.samples.iter().skip(1)) {
            path_x += (b.x - a.x).abs();
            path_y += (b.y - a.y).abs();
        }
        let horizontal = path_x >= path_y;
        count_reversals(
            self.samples
                .iter()
                .map(|s| if horizontal { s.x } else { s.y }),
            MIN_SWING,
        )
    }
}

/// Zig-zag filter: a reversal is counted each time the value retreats at least `min_swing`
/// from the extreme reached in the current direction. Movement below the threshold (jitter,
/// slow drift) never counts, and the very first swing only establishes a direction.
fn count_reversals(values: impl Iterator<Item = f64>, min_swing: f64) -> u32 {
    let mut values = values;
    let Some(first) = values.next() else { return 0 };
    let mut dir = 0i8; // 0 = not yet established
    let mut extreme = first;
    let mut reversals = 0;
    for v in values {
        match dir {
            0 => {
                if (v - extreme).abs() >= min_swing {
                    dir = if v > extreme { 1 } else { -1 };
                    extreme = v;
                }
            }
            1 => {
                if v > extreme {
                    extreme = v;
                } else if extreme - v >= min_swing {
                    reversals += 1;
                    dir = -1;
                    extreme = v;
                }
            }
            _ => {
                if v < extreme {
                    extreme = v;
                } else if v - extreme >= min_swing {
                    reversals += 1;
                    dir = 1;
                    extreme = v;
                }
            }
        }
    }
    reversals
}

/// Physical -> logical pixels. A bogus scale factor (0, NaN, negative) is treated as 1.
pub fn to_logical(physical: i32, scale_factor: f64) -> f64 {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    f64::from(physical) / scale
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    /// Feeds `(dt_ms, x, y)` samples; returns the indexes at which a shake fired.
    fn run(det: &mut ShakeDetector, base: Instant, samples: &[(u64, f64, f64)]) -> Vec<usize> {
        samples
            .iter()
            .enumerate()
            .filter_map(|(i, &(t, x, y))| det.feed(ms(base, t), x, y).then_some(i))
            .collect()
    }

    #[test]
    fn horizontal_shake_fires_on_the_third_reversal() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        // right, left, right, left: 3 reversals, 60 ms apart.
        let s = [
            (0, 0.0, 0.0),
            (60, 20.0, 0.0),
            (120, 0.0, 0.0),
            (180, 20.0, 0.0),
            (240, 0.0, 0.0),
        ];
        assert_eq!(run(&mut det, base, &s), vec![4]);
    }

    #[test]
    fn vertical_shake_fires() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let s = [
            (0, 5.0, 0.0),
            (50, 6.0, 25.0),
            (100, 5.0, 0.0),
            (150, 6.0, 25.0),
            (200, 5.0, 0.0),
        ];
        assert_eq!(run(&mut det, base, &s), vec![4]);
    }

    #[test]
    fn dominant_axis_wins_with_diagonal_wobble() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        // big x zig-zag, y wanders in one direction
        let s = [
            (0, 0.0, 0.0),
            (50, 30.0, 4.0),
            (100, 0.0, 8.0),
            (150, 30.0, 12.0),
            (200, 0.0, 16.0),
        ];
        assert_eq!(run(&mut det, base, &s), vec![4]);
    }

    #[test]
    fn straight_drag_never_fires() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let s: Vec<_> = (0..200)
            .map(|i| (i * 8, i as f64 * 5.0, i as f64 * 2.0))
            .collect();
        assert!(run(&mut det, base, &s).is_empty());
    }

    #[test]
    fn small_jitter_is_ignored() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        // +-5 px wobble forever: never a 12 px swing.
        let s: Vec<_> = (0..100)
            .map(|i| (i * 10, if i % 2 == 0 { 0.0 } else { 5.0 }, 0.0))
            .collect();
        assert!(run(&mut det, base, &s).is_empty());
    }

    #[test]
    fn swing_just_under_threshold_does_not_count() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let s = [
            (0, 0.0, 0.0),
            (50, 11.9, 0.0),
            (100, 0.0, 0.0),
            (150, 11.9, 0.0),
            (200, 0.0, 0.0),
        ];
        assert!(run(&mut det, base, &s).is_empty());
        let mut det = ShakeDetector::new();
        let s = [
            (0, 0.0, 0.0),
            (50, 12.0, 0.0),
            (100, 0.0, 0.0),
            (150, 12.0, 0.0),
            (200, 0.0, 0.0),
        ];
        assert_eq!(run(&mut det, base, &s), vec![4]);
    }

    #[test]
    fn two_reversals_are_not_enough() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let s = [
            (0, 0.0, 0.0),
            (60, 20.0, 0.0),
            (120, 0.0, 0.0),
            (180, 20.0, 0.0),
        ];
        assert!(run(&mut det, base, &s).is_empty());
    }

    #[test]
    fn slow_swings_outside_the_window_do_not_add_up() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        // a reversal every 300 ms: never 3 within 700 ms.
        let s: Vec<_> = (0..20)
            .map(|i| (i * 300, if i % 2 == 0 { 0.0 } else { 40.0 }, 0.0))
            .collect();
        assert!(run(&mut det, base, &s).is_empty());
    }

    #[test]
    fn cooldown_suppresses_then_rearms() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        // Continuous vigorous shaking for 5 s, a sample every 40 ms (20 px swings every 40 ms).
        let s: Vec<_> = (0..125)
            .map(|i| (i * 40, if i % 2 == 0 { 0.0 } else { 20.0 }, 0.0))
            .collect();
        let fired = run(&mut det, base, &s);
        assert!(
            fired.len() >= 2,
            "should re-arm after the cooldown: {fired:?}"
        );
        for pair in fired.windows(2) {
            let gap = (pair[1] - pair[0]) as u64 * 40;
            assert!(
                gap >= COOLDOWN.as_millis() as u64,
                "fired again after only {gap} ms"
            );
        }
        // The first swing only sets a direction; reversals land on samples 2, 3, 4.
        assert_eq!(fired[0], 4);
    }

    #[test]
    fn motion_during_cooldown_does_not_prime_the_next_shake() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let s = [
            (0, 0.0, 0.0),
            (50, 20.0, 0.0),
            (100, 0.0, 0.0),
            (150, 20.0, 0.0),
            (200, 0.0, 0.0),
        ];
        assert_eq!(run(&mut det, base, &s), vec![4]);
        // Shake hard for 1.5 s (still cooling down) ...
        let during: Vec<_> = (0..30)
            .map(|i| (250 + i * 50, if i % 2 == 0 { 0.0 } else { 20.0 }, 0.0))
            .collect();
        assert!(run(&mut det, base, &during).is_empty());
        // ... then a single swing right after the cooldown must not fire on stale samples.
        assert!(!det.feed(ms(base, 2200), 0.0, 0.0));
        assert!(!det.feed(ms(base, 2250), 20.0, 0.0));
    }

    #[test]
    fn long_gap_resets_history() {
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        assert!(!det.feed(ms(base, 0), 0.0, 0.0));
        assert!(!det.feed(ms(base, 50), 20.0, 0.0));
        assert!(!det.feed(ms(base, 100), 0.0, 0.0));
        // two seconds of nothing, then the last swing: old samples have expired.
        assert!(!det.feed(ms(base, 2100), 20.0, 0.0));
    }

    #[test]
    fn logical_conversion() {
        assert_eq!(to_logical(24, 2.0), 12.0);
        assert_eq!(to_logical(-30, 1.5), -20.0);
        assert_eq!(to_logical(10, 0.0), 10.0);
        assert_eq!(to_logical(10, f64::NAN), 10.0);
        assert_eq!(to_logical(10, -1.0), 10.0);
    }

    #[test]
    fn hidpi_threshold_is_in_logical_pixels() {
        // 20 physical px at 2x = 10 logical px: below the 12 px swing, so no shake.
        let base = Instant::now();
        let mut det = ShakeDetector::new();
        let phys = [0, 20, 0, 20, 0];
        let fired: Vec<_> = phys
            .iter()
            .enumerate()
            .filter(|&(i, &p)| det.feed(ms(base, i as u64 * 50), to_logical(p, 2.0), 0.0))
            .collect();
        assert!(fired.is_empty());
    }
}
