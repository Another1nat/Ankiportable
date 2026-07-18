// Simplified SM-2 scheduler with learning steps for new cards.
//
// Card state (per card, persisted):
//   state: 'new' | 'learning' | 'review'
//   learningStep: index into LEARNING_STEPS_MIN
//   interval: days (only meaningful in 'review')
//   ease: multiplier (starts 2.5, floor 1.3)
//   reps: consecutive successful reviews
//   lapses: how many times it dropped from review back to relearn
//   dueAt: ISO date-time string (ms precision)
//   lastReviewedAt: ISO string or null
//
// Grades: 0=Again, 1=Hard, 2=Good, 3=Easy

const LEARNING_STEPS_MIN = [1, 10]; // 1 min, 10 min
const GRADUATING_INTERVAL_DAYS = 1;
const EASY_INTERVAL_DAYS = 4;
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

function nowMs() { return Date.now(); }
function addMinutes(ms, m) { return ms + m * 60 * 1000; }
function addDays(ms, d) { return ms + d * 86400 * 1000; }
function toISO(ms) { return new Date(ms).toISOString(); }
function fromISO(s) { return s ? new Date(s).getTime() : 0; }

function initialState() {
  return {
    state: 'new',
    learningStep: 0,
    interval: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    dueAt: toISO(nowMs()),
    lastReviewedAt: null,
  };
}

// Apply a grade to a card's SR state; mutates and returns the new state.
function grade(state, g) {
  const s = { ...state };
  const now = nowMs();
  s.lastReviewedAt = toISO(now);

  if (s.state === 'new' || s.state === 'learning') {
    if (g === 0) {
      // Again → back to step 0
      s.state = 'learning';
      s.learningStep = 0;
      s.dueAt = toISO(addMinutes(now, LEARNING_STEPS_MIN[0]));
    } else if (g === 3) {
      // Easy graduates immediately with a longer interval
      s.state = 'review';
      s.interval = EASY_INTERVAL_DAYS;
      s.reps = 1;
      s.dueAt = toISO(addDays(now, s.interval));
    } else {
      // Hard/Good → advance a step, graduate if done
      const nextStep = s.learningStep + (g === 1 ? 0 : 1);
      if (nextStep >= LEARNING_STEPS_MIN.length) {
        s.state = 'review';
        s.interval = GRADUATING_INTERVAL_DAYS;
        s.reps = 1;
        s.dueAt = toISO(addDays(now, s.interval));
      } else {
        s.state = 'learning';
        s.learningStep = nextStep;
        s.dueAt = toISO(addMinutes(now, LEARNING_STEPS_MIN[nextStep]));
      }
    }
    return s;
  }

  // Review state — classic SM-2 grading
  if (g === 0) {
    s.lapses += 1;
    s.reps = 0;
    s.ease = Math.max(MIN_EASE, s.ease - 0.20);
    s.state = 'learning';
    s.learningStep = 0;
    s.dueAt = toISO(addMinutes(now, LEARNING_STEPS_MIN[0]));
    return s;
  }

  const prevInterval = Math.max(1, s.interval);
  let newInterval;
  if (g === 1) {
    newInterval = prevInterval * 1.2;
    s.ease = Math.max(MIN_EASE, s.ease - 0.15);
  } else if (g === 2) {
    newInterval = prevInterval * s.ease;
    // ease unchanged
  } else { // g === 3, Easy
    newInterval = prevInterval * s.ease * 1.3;
    s.ease = s.ease + 0.15;
  }
  newInterval = Math.max(1, Math.round(newInterval));
  s.interval = newInterval;
  s.reps += 1;
  s.dueAt = toISO(addDays(now, newInterval));
  return s;
}

// Preview the next interval for a grade without mutating state.
// Returns a human-friendly string.
function previewInterval(state, g) {
  const s = grade(state, g);
  const dueMs = fromISO(s.dueAt);
  const deltaMs = dueMs - nowMs();
  const mins = Math.round(deltaMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = (days / 30).toFixed(1);
  return `${months}mo`;
}

// Build a study queue from card SR states.
// Rules:
//   - All non-new cards whose dueAt <= now → include (due, learning + review)
//   - New cards → include up to `newDailyCap`, respecting cards already seen today
// Deterministic-ish ordering: due learning first, then due review, then new.
function buildQueue(cardStates, newDailyCap, todayCounts) {
  const now = nowMs();
  const learning = [];
  const review = [];
  const newCards = [];

  for (const [cardId, st] of Object.entries(cardStates)) {
    if (st.state === 'new') {
      newCards.push(cardId);
    } else if (fromISO(st.dueAt) <= now) {
      if (st.state === 'learning') learning.push(cardId);
      else review.push(cardId);
    }
  }

  const unlimited = !newDailyCap || newDailyCap <= 0 || !isFinite(newDailyCap);
  const cappedNew = unlimited
    ? newCards
    : newCards.slice(0, Math.max(0, newDailyCap - (todayCounts?.newIntroduced || 0)));

  return {
    learning,
    review,
    newCards: cappedNew,
    counts: {
      learning: learning.length,
      review: review.length,
      new: cappedNew.length,
      total: learning.length + review.length + cappedNew.length,
    },
  };
}

window.Scheduler = {
  initialState,
  grade,
  previewInterval,
  buildQueue,
  LEARNING_STEPS_MIN,
  DEFAULT_NEW_DAILY_CAP: 20,
};
