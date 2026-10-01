import type { FoldError } from '../core';
import type { PhaseKind, Tool } from './editor/Editor';

export const TOOL_LABEL: Record<Tool, { icon: string; text: string }> = {
  line: { icon: '✏️', text: '畫線' },
  point: { icon: '📍', text: '點對點' },
  edge: { icon: '📐', text: '邊對邊' },
};

export const HINT: Record<Tool, Partial<Record<PhaseKind, string>>> = {
  line: {
    idle: '按住滑鼠，畫一條摺線',
    drawing: '放開滑鼠，線就畫好了',
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
};
