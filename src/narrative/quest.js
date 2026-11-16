// Y'SMARA — objectives, dialogue scripts and the ending logic.
// The story is told through: the opening rite, NPC dialogue, memory echoes (24 vignettes),
// cantos (8 lore pages), the bells, and two contrary endings. All text is original.
import { BELLS, SHRINES, ECHOES, CANTOS, NPCS, SECRETS } from '../world/world.js';

export const OBJECTIVES = [
  { id: 'wake', title: 'Hear the Coast', hint: 'Ring the Bell of Ashbend, then speak with Mother Senn.', mark: null },
  { id: 'descend', title: 'Descend the Kneeling One', hint: 'Follow the causeway down to the Silt Shallows.', mark: { x: 4, z: -240 } },
  { id: 'find_wren', title: 'Find Wren in Kell', hint: 'Kell sits on stilts west of the causeway.', mark: { x: -44, z: -52 } },
  { id: 'ring_bells', title: 'Wake the Three Lost Bells', hint: 'The Ossuary (east), the Glass Reach (west), the Hollow (south).', mark: null },
  { id: 'reach_hollow', title: 'Walk into the Hollow', hint: 'The Hollow lies south, past the Verge. The bells will open the way.', mark: { x: 6, z: 232 } },
  { id: 'meet_orin', title: 'Find the Ninth Voice', hint: 'Orin stands at the mouth of the maw, holding a note.', mark: { x: 0, z: 274 } },
  { id: 'decide', title: 'Finish — or Keep — the Verse', hint: 'Choose at the maw. There is no wrong answer. There is no easy one.', mark: { x: 4, z: 262 } },
  { id: 'ending', title: 'Ending', hint: '', mark: null },
];

/** Intro rite: a short cinematic that teaches the Hymn through play. */
export const INTRO_SCRIPT = [
  { t: 0.0, kind: 'fade', to: 1.0, dur: 1.4 },
  { t: 0.4, kind: 'camera', pos: { x: -22, y: 45, z: -270 }, look: { x: 0, z: -304, y: 44 }, fov: 52, dur: 6.0 },
  { t: 1.2, kind: 'line', speaker: 'Mother Senn', text: 'The coast has been singing itself to sleep for eleven years, Aru. Tonight it stopped.' },
  { t: 4.4, kind: 'line', speaker: 'Mother Senn', text: 'You are the last Listener. That means you hear what the sea is trying not to say.' },
  { t: 7.4, kind: 'line', speaker: 'Mother Senn', text: 'Ashbend\'s bell has not rung since dusk. Ring it. Then follow the causeway down. Find Wren.' },
  { t: 10.6, kind: 'tutorial', text: 'HOLD  the  ◎  button  to sing · RELEASE to shape the syllable' },
  { t: 13.0, kind: 'fade', to: 0.0, dur: 1.2 },
];

export const ENDINGS = {
  rest: {
    id: 'rest', title: 'LET IT REST',
    subtitle: 'You finished the Ninth Verse.',
    lines: [
      'The note you did not want to sing leaves your mouth and keeps going.',
      'Orin listens to the end of it. For the first time in eleven years, he is not holding anything.',
      'The Hollow closes the way a book closes: not violently. Just done.',
      'The sea comes back up the beach at Ashbend, and it is only the sea.',
      'Mother Senn finds you at the bell at dawn, asleep standing up, still humming.',
      'The world is smaller now. It is also, for the first time, finished.',
    ],
    color: 0xffe6a0,
  },
  keep: {
    id: 'keep', title: 'KEEP THE NOTE',
    subtitle: 'You refused to finish it.',
    lines: [
      'You swallow the last syllable. It goes down like a stone.',
      'Orin laughs — a real, surprised, human sound. "Then I have company," he says.',
      'You hold the Verse open between you. The Hollow stays a held breath, and so does the coast.',
      'Every night the bells ring with a question that is not a question. Every morning the tide answers badly.',
      'Nothing is finished. Everything is still possible.',
      'You have chosen: a world that goes on being unfinished is still a world that goes on.',
    ],
    color: 0x9fe8d8,
  },
};

/** Dialogue trees. Each node: {text, speaker, next?, choices?} */
export const DIALOGUES = {
  senn_intro: {
    speaker: 'Mother Senn',
    nodes: [
      { text: 'You rang it. Good. Half the village thought you would sleep through the end of the world.', next: 1 },
      { text: 'Listen, Aru. Three bells are missing from the Choir — the Marrow Chime, the Glass Knell, and the one we never named.', next: 2 },
      { text: 'Ring all three and the Hollow will open like a door instead of a mouth. That is the difference, and it is the only difference.', next: 3 },
      { text: 'Wren is in Kell. She will pretend not to help you. Let her.', choices: [
        { text: '"What is in the Hollow?"', next: 4 },
        { text: '"Why me?"', next: 5 },
        { text: 'Leave.', end: true },
      ]},
      { text: 'A boy who volunteered, and has been holding a note for eleven years. Do not pity him. He is very proud of it.', next: 5 },
      { text: 'Because you are the only one left who can hear the difference between a bell and a warning.', end: true },
    ],
  },
  wren_intro: {
    speaker: 'Wren',
    nodes: [
      { text: 'A Listener. Wonderful. The last one went south to finish a song and came back as weather.', next: 1 },
      { text: 'Here. My map. Fish scales, rope, and an unreasonable amount of spite — it will get you to the bells.', next: 2 },
      { text: 'Two things. One: the Mutes hate a bell. It reminds them they used to have a voice.', next: 3 },
      { text: 'Two: if the Hollow sings your name, do not answer. That is how it got Orin.', choices: [
        { text: '"How do you know my name?"', next: 4 },
        { text: '"I will bring him back."', next: 5 },
        { text: 'Leave.', end: true },
      ]},
      { text: 'Everyone on this coast knows your name, Aru. You are the only one who has not been listening.', next: 5 },
      { text: 'You can bring back a man. You cannot bring back a note once it has finished. Choose which one you are going for.', end: true },
    ],
  },
  tol_intro: {
    speaker: 'Tol',
    nodes: [
      { text: 'Glass, glass, all glass, and none of it worth the salt in my boots.', next: 1 },
      { text: 'The Third Bell hangs in the shattered amphitheatre west of here. The acoustics will do things to your bones.', next: 2 },
      { text: 'And Listener — when you ring it, sing with it. A bell rung alone is just a noise.', end: true },
    ],
  },
  marrow_intro: {
    speaker: 'The Marrow Warden',
    nodes: [
      { text: 'I was a singer. Now I am a room.', next: 1 },
      { text: 'The bell you seek is in my heart. Take it. But leave me the echo — it is the last thing I own.', next: 2 },
      { text: 'When you ring it, sing with it. I have not heard my own note since the sea took it back.', end: true },
    ],
  },
  orin_intro: {
    speaker: 'Orin',
    nodes: [
      { text: 'You are late. Or early. Time is one of the things I stopped finishing.', next: 1 },
      { text: 'I did not make the Hollow. I held it open. There is a difference, and it matters, and no one will believe me.', next: 2 },
      { text: 'If you finish the Verse, I can rest. If you do not, I will keep holding it. I am good at holding things.', choices: [
        { text: '"Why did you volunteer?"', next: 3 },
        { text: '"What happens if I finish it?"', next: 4 },
        { text: '"I am ready to choose."', next: 5 },
      ]},
      { text: 'Because someone had to, and everyone else was too kind to be chosen.', next: 5 },
      { text: 'The coast remembers being a coast. Then it is only a coast. That is either a mercy or a loss. I have had eleven years and I still cannot tell.', next: 5 },
      { text: 'Then choose. I will not stop you either way. That is the one kindness I have left.', choices: [
        { text: 'FINISH THE VERSE — let it rest.', ending: 'rest' },
        { text: 'KEEP THE NOTE — hold the world open.', ending: 'keep' },
      ]},
    ],
  },
};

/** Objective logic. Pure functions so it can be unit-tested. */
export function createQuestState() {
  return { objectiveIndex: 0, bells: [], echoes: [], cantos: [], secrets: [], shrines: [], flags: {}, visited: {} };
}

export function advanceObjective(q, save, notify) {
  const cur = OBJECTIVES[q.objectiveIndex];
  if (!cur) return;
  let done = false;
  switch (cur.id) {
    case 'wake': done = save.shrines.includes('shrine_ashbend') && save.flags.talkedSenn; break;
    case 'descend': done = save.flags.leftAshbend; break;
    case 'find_wren': done = save.flags.talkedWren; break;
    case 'ring_bells': done = save.bells.length >= 3; break;
    case 'reach_hollow': done = save.flags.enteredHollow; break;
    case 'meet_orin': done = save.flags.talkedOrin; break;
    case 'decide': done = !!save.ending; break;
    default: done = false;
  }
  if (done) {
    q.objectiveIndex++;
    notify?.(OBJECTIVES[q.objectiveIndex]);
  }
}

export function currentObjective(save) {
  const idx = Math.min(save.objectiveIndex || 0, OBJECTIVES.length - 1);
  const o = OBJECTIVES[idx];
  if (o.id === 'ring_bells') {
    const remaining = BELLS.filter((b) => !save.bells.includes(b.id));
    return { ...o, hint: remaining.map((b) => `${b.name}: ${b.hint}`).join('  ·  ') || o.hint };
  }
  if (o.id === 'decide') return { ...o };
  return o;
}

/** Progress summary used by the HUD and the save-slot cards. */
export function completionStats(save) {
  return {
    echoes: `${save.echoes.length}/${ECHOES.length}`,
    cantos: `${save.cantos.length}/${CANTOS.length}`,
    bells: `${save.bells.length}/${BELLS.length}`,
    shrines: `${save.shrines.length}/${SHRINES.length}`,
    secrets: `${save.secrets.length}/${SECRETS.length}`,
    percent: Math.round(
      ((save.echoes.length / ECHOES.length) * 0.35 +
        (save.cantos.length / CANTOS.length) * 0.15 +
        (save.bells.length / BELLS.length) * 0.2 +
        (save.shrines.length / SHRINES.length) * 0.15 +
        (save.secrets.length / SECRETS.length) * 0.15) * 100,
    ),
  };
}

export function npcDialogueFor(npcId, save) {
  switch (npcId) {
    case 'senn': return save.flags.talkedSenn ? 'senn_repeat' : 'senn_intro';
    case 'wren': return save.flags.talkedWren ? 'wren_repeat' : 'wren_intro';
    case 'tol': return save.flags.talkedTol ? 'tol_repeat' : 'tol_intro';
    case 'marrow': return save.flags.talkedMarrow ? 'marrow_repeat' : 'marrow_intro';
    case 'orin': return 'orin_intro';
    default: return null;
  }
}

DIALOGUES.senn_repeat = { speaker: 'Mother Senn', nodes: [
  { text: 'The bells are east, west and south. Ring them in any order. The Hollow keeps its own order.', next: 1 },
  { text: 'And Aru — come back. That is not a duty. That is a request.', end: true },
] };
DIALOGUES.wren_repeat = { speaker: 'Wren', nodes: [
  { text: 'Still alive. My scales were wrong about you, and I resent it.', next: 1 },
  { text: 'The Ossuary is east. The Glass Reach is west. The Hollow is south and I would not go, but you will.', end: true },
] };
DIALOGUES.tol_repeat = { speaker: 'Tol', nodes: [
  { text: 'Sing with the bell. I meant it. The Reach remembers company.', end: true },
] };
DIALOGUES.marrow_repeat = { speaker: 'The Marrow Warden', nodes: [
  { text: 'You carry my note now. It is heavier than it looks. That is how you know it is real.', end: true },
] };

export const EPILOGUE_NOTES = [
  { id: 'note_echoes', cond: (s) => s.echoes.length >= ECHOES.length, text: 'You recovered every memory on the coast. Nothing here is unremembered now.' },
  { id: 'note_secrets', cond: (s) => s.secrets.length >= SECRETS.length, text: 'You found all five secret places. The coast had been waiting to be looked at.' },
  { id: 'note_cantos', cond: (s) => s.cantos.length >= CANTOS.length, text: 'You read all eight cantos. You know exactly what the Choir did, and why.' },
  { id: 'note_nokill', cond: (s) => (s.stats?.kills || 0) === 0, text: 'You reached the maw without silencing a single Mute. There is a word for that, and the Choir never had it.' },
];
