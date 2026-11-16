// Y'SMARA — objectives, dialogue scripts and the ending logic.
// The story is told through: the opening rite, NPC dialogue, memory echoes (24 vignettes),
// cantos (8 lore pages), the bells, and two contrary endings. All text is original.
import { BELLS, SHRINES, ECHOES, CANTOS, NPCS, SECRETS } from '../world/world.js';

export const OBJECTIVES = [
  { id: 'wake', title: 'Ouça a Costa', hint: 'Toque o Sino de Ashbend e depois fale com Mãe Senn.', mark: null },
  { id: 'descend', title: 'Desça pelo Ajoelhado', hint: 'Siga a passagem até os Baixios de Lodo.', mark: { x: 4, z: -240 } },
  { id: 'find_wren', title: 'Encontre Wren em Kell', hint: 'Kell fica sobre palafitas, a oeste da passagem.', mark: { x: -44, z: -52 } },
  { id: 'ring_bells', title: 'Desperte os Três Sinos Perdidos', hint: 'O Ossuário (leste), o Alcance de Vidro (oeste), o Oco (sul).', mark: null },
  { id: 'reach_hollow', title: 'Entre no Oco', hint: 'O Oco fica ao sul, além da Beira. Os sinos abrem o caminho.', mark: { x: 6, z: 232 } },
  { id: 'meet_orin', title: 'Encontre a Nona Voz', hint: 'Orin espera na boca do abismo, segurando uma nota.', mark: { x: 0, z: 274 } },
  { id: 'decide', title: 'Termine — ou Guarde — o Verso', hint: 'Escolha na boca do abismo. Não existe resposta errada. Nem fácil.', mark: { x: 4, z: 262 } },
  { id: 'ending', title: 'Final', hint: '', mark: null },
];

/** Intro rite: a short cinematic that teaches the Hymn through play. */
export const INTRO_SCRIPT = [
  { t: 0.0, kind: 'fade', to: 1.0, dur: 1.4 },
  { t: 0.4, kind: 'camera', pos: { x: -22, y: 45, z: -270 }, look: { x: 0, z: -304, y: 44 }, fov: 52, dur: 6.0 },
  { t: 1.2, kind: 'line', speaker: 'Mãe Senn', text: 'A costa canta para dormir há onze anos, Aru. Esta noite, o canto parou.' },
  { t: 4.4, kind: 'line', speaker: 'Mãe Senn', text: 'Você é a última Ouvinte. Isso significa que você ouve o que o mar tenta não dizer.' },
  { t: 7.4, kind: 'line', speaker: 'Mãe Senn', text: 'O sino de Ashbend não toca desde o anoitecer. Toque-o. Depois desça pela passagem. Encontre Wren.' },
  { t: 10.6, kind: 'tutorial', text: 'SEGURE o botão ◎ para cantar · SOLTE para moldar a sílaba' },
  { t: 13.0, kind: 'fade', to: 0.0, dur: 1.2 },
];

export const ENDINGS = {
  rest: {
    id: 'rest', title: 'DEIXE DESCANSAR',
    subtitle: 'Você terminou o Nono Verso.',
    lines: [
      'A nota que você não queria cantar sai da sua boca e continua.',
      'Orin escuta até o fim dela. Pela primeira vez em onze anos, ele não está segurando nada.',
      'O Oco se fecha como um livro se fecha: sem violência. Apenas concluído.',
      'O mar sobe de volta pela praia de Ashbend, e é só o mar.',
      'Mãe Senn encontra você junto ao sino ao amanhecer, dormindo em pé, ainda cantarolando.',
      'O mundo ficou menor agora. E também, pela primeira vez, terminado.',
    ],
    color: 0xffe6a0,
  },
  keep: {
    id: 'keep', title: 'GUARDE A NOTA',
    subtitle: 'Você se recusou a terminar.',
    lines: [
      'Você engole a última sílaba. Ela desce como uma pedra.',
      'Orin ri — um som humano, real, de surpresa. "Então tenho companhia", ele diz.',
      'Vocês seguram o Verso aberto entre si. O Oco permanece um fôlego suspenso, e a costa também.',
      'Toda noite os sinos tocam com uma pergunta que não é pergunta. Toda manhã a maré responde mal.',
      'Nada está terminado. Tudo ainda é possível.',
      'Você escolheu: um mundo que segue inacabado ainda é um mundo que segue.',
    ],
    color: 0x9fe8d8,
  },
};

/** Dialogue trees. Each node: {text, speaker, next?, choices?} */
export const DIALOGUES = {
  senn_intro: {
    speaker: 'Mãe Senn',
    nodes: [
      { text: 'Você tocou. Bom. Metade da vila achou que você dormiria até o fim do mundo.', next: 1 },
      { text: 'Escute, Aru. Faltam três sinos no Coro — o Dobrar do Tutano, o Repique de Vidro, e aquele que nunca demos nome.', next: 2 },
      { text: 'Toque os três e o Oco abrirá como porta em vez de boca. Essa é a diferença, e é a única diferença.', next: 3 },
      { text: 'Wren está em Kell. Ela vai fingir que não ajuda. Deixe que finja.', choices: [
        { text: '"O que existe no Oco?"', next: 4 },
        { text: '"Por que eu?"', next: 5 },
        { text: 'Sair.', end: true },
      ]},
      { text: 'Um menino que se ofereceu, e que segura uma nota há onze anos. Não sinta pena dele. Ele tem muito orgulho disso.', next: 5 },
      { text: 'Porque você é a única que restou capaz de ouvir a diferença entre um sino e um aviso.', end: true },
    ],
  },
  wren_intro: {
    speaker: 'Wren',
    nodes: [
      { text: 'Uma Ouvinte. Maravilha. A última foi para o sul terminar uma canção e voltou como tempo ruim.', next: 1 },
      { text: 'Toma. Meu mapa. Escama de peixe, corda e uma quantidade irrazoável de rancor — ele te leva aos sinos.', next: 2 },
      { text: 'Duas coisas. Uma: os Mudos odeiam sino. Isso lembra que eles já tiveram voz.', next: 3 },
      { text: 'Dois: se o Oco cantar o seu nome, não responda. Foi assim que ele pegou Orin.', choices: [
        { text: '"Como você sabe meu nome?"', next: 4 },
        { text: '"Eu vou trazê-lo de volta."', next: 5 },
        { text: 'Sair.', end: true },
      ]},
      { text: 'Todo mundo nesta costa sabe o seu nome, Aru. Você é a única que não estava escutando.', next: 5 },
      { text: 'Dá para trazer um homem de volta. Não dá para trazer uma nota depois que ela termina. Escolha qual dos dois você vai buscar.', end: true },
    ],
  },
  tol_intro: {
    speaker: 'Tol',
    nodes: [
      { text: 'Vidro, vidro, só vidro, e nada disso vale o sal nas minhas botas.', next: 1 },
      { text: 'O Terceiro Sino está no anfiteatro em ruínas, a oeste daqui. A acústica faz coisas com os seus ossos.', next: 2 },
      { text: 'E, Ouvinte — quando tocar, cante junto. Sino tocado sozinho é só um barulho.', end: true },
    ],
  },
  marrow_intro: {
    speaker: 'O Guardião do Tutano',
    nodes: [
      { text: 'Eu era cantor. Agora sou um cômodo.', next: 1 },
      { text: 'O sino que você procura está no meu peito. Leve-o. Mas me deixe o eco — é a última coisa que possuo.', next: 2 },
      { text: 'Quando tocar, cante junto. Não ouço a minha própria nota desde que o mar a tomou de volta.', end: true },
    ],
  },
  orin_intro: {
    speaker: 'Orin',
    nodes: [
      { text: 'Você está atrasada. Ou adiantada. O tempo é uma das coisas que eu parei de terminar.', next: 1 },
      { text: 'Eu não fiz o Oco. Eu o mantive aberto. Há uma diferença, e ela importa, e ninguém vai acreditar em mim.', next: 2 },
      { text: 'Se você terminar o Verso, eu posso descansar. Se não, eu continuo segurando. Eu sou bom em segurar coisas.', choices: [
        { text: '"Por que você se ofereceu?"', next: 3 },
        { text: '"O que acontece se eu terminar?"', next: 4 },
        { text: '"Estou pronta para escolher."', next: 5 },
      ]},
      { text: 'Porque alguém precisava, e todos os outros eram gentis demais para serem escolhidos.', next: 5 },
      { text: 'A costa lembra de ter sido costa. Depois ela é só uma costa. Isso é uma misericórdia ou uma perda. Já se passaram onze anos e eu ainda não sei.', next: 5 },
      { text: 'Então escolha. Não vou te impedir de nenhum dos dois jeitos. É a única gentileza que me resta.', choices: [
        { text: 'TERMINAR O VERSO — deixe descansar.', ending: 'rest' },
        { text: 'GUARDAR A NOTA — mantenha o mundo aberto.', ending: 'keep' },
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

DIALOGUES.senn_repeat = { speaker: 'Mãe Senn', nodes: [
  { text: 'Os sinos estão a leste, a oeste e ao sul. Toque na ordem que quiser. O Oco guarda a ordem dele.', next: 1 },
  { text: 'E, Aru — volte. Isso não é um dever. É um pedido.', end: true },
] };
DIALOGUES.wren_repeat = { speaker: 'Wren', nodes: [
  { text: 'Ainda viva. Minhas escamas erraram sobre você, e eu guardo rancor disso.', next: 1 },
  { text: 'O Ossuário fica a leste. O Alcance de Vidro, a oeste. O Oco, ao sul, e eu não iria, mas você vai.', end: true },
] };
DIALOGUES.tol_repeat = { speaker: 'Tol', nodes: [
  { text: 'Cante junto com o sino. Eu falei sério. O Alcance lembra de companhia.', end: true },
] };
DIALOGUES.marrow_repeat = { speaker: 'O Guardião do Tutano', nodes: [
  { text: 'Agora você carrega a minha nota. É mais pesada do que parece. É assim que se sabe que é real.', end: true },
] };

export const EPILOGUE_NOTES = [
  { id: 'note_echoes', cond: (s) => s.echoes.length >= ECHOES.length, text: 'Você recuperou cada memória da costa. Nada aqui está sem lembrança agora.' },
  { id: 'note_secrets', cond: (s) => s.secrets.length >= SECRETS.length, text: 'Você encontrou os cinco lugares secretos. A costa esperava ser olhada.' },
  { id: 'note_cantos', cond: (s) => s.cantos.length >= CANTOS.length, text: 'Você leu os oito cantos. Sabe exatamente o que o Coro fez, e por quê.' },
  { id: 'note_nokill', cond: (s) => (s.stats?.kills || 0) === 0, text: 'Você chegou ao abismo sem silenciar um único Mudo. Existe uma palavra para isso, e o Coro nunca a teve.' },
];
