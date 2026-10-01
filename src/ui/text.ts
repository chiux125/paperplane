import type { FoldError, ReverseStyle, StabilityVerdict } from '../core';
import type { PhaseKind, Tool } from './editor/Editor';

/** 反摺選項的孩子用說法（不講內翻／外翻術語）。 */
export const REVERSE_LABEL: Record<ReverseStyle, { icon: string; text: string }> = {
  over: { icon: '🔼', text: '蓋在上面' },
  under: { icon: '🔽', text: '收到下面' },
  inside: { icon: '📥', text: '塞進裡面' },
  outside: { icon: '🤲', text: '包在外面' },
  'top-over': { icon: '☝️', text: '只摺最上面那片' },
  'top-under': { icon: '👇', text: '只摺最上面（收起）' },
};

/** 穩定度提示（給 8 歲孩子看的話）。 */
export const STABILITY_TEXT: Record<StabilityVerdict, { emoji: string; text: string }> = {
  'pitch-up': { emoji: '🙃', text: '重心太後面，可能會仰頭！' },
  stable: { emoji: '👍', text: '穩穩的！' },
  'nose-dive': { emoji: '😵', text: '機頭太重，可能會往下衝' },
};

export const TOOL_LABEL: Record<Tool, { icon: string; text: string }> = {
  line: { icon: '✏️', text: '畫線' },
  point: { icon: '📍', text: '點對點' },
  edge: { icon: '📐', text: '邊對邊' },
};

export const HINT: Record<Tool, Partial<Record<PhaseKind, string>>> = {
  line: {
    idle: '按住滑鼠畫一條摺線（按住 Shift 會變直的）',
    drawing: '放開滑鼠就畫好；按住 Shift 會變成水平或垂直',
    side: '點一下要翻過去的那一邊',
  },
  point: {
    idle: '點一下要移動的點',
    pointA: '再點一下，要把它摺到哪裡？',
  },
  edge: {
    idle: '點一條要移動的邊',
    edgeFrom: '再點一條邊（或中間的虛線），把它們對齊',
  },
};

export const ERROR_TEXT: Record<FoldError, string> = {
  'pick-on-line': '點在線的旁邊一點點喔',
  'nothing-to-fold': '這條線沒有摺到紙喔',
  'too-thin': '這樣會摺出很細很細的一條，換個地方試試',
  'crosses-center': '這樣摺會跨過中線，左右兩邊會撞在一起喔',
  'same-point': '要點兩個不一樣的地方喔',
  'same-line': '這兩條邊已經對齊了喔',
  'reverse-pierces': '這樣摺會穿過紙，換一個摺法試試',
};
