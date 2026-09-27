(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
  else root.LabLevels = factory(root.LabPhysics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(P) {
  const plank = (id, x, y, length, angle) => P.part('plank', x, y, angle * P.DEG, { id, length });
  const spring = (id, x, y, angle, power) => P.part('spring', x, y, angle * P.DEG, { id, power });
  const fan = (id, x, y, angle, power) => P.part('fan', x, y, angle * P.DEG, { id, power });
  return [
    { id: 'first-delivery', name: '滑一下', tag: '重力入门', title: '把小球，送到终点。',
      description: '搭一条路，或者发明一台离谱机器。只要把小球送进绿色篮筐，就算成功。',
      hint: '坡道向右下方倾斜，小球就会滚起来。记得接住坡道末端的小球。', budget: 8, par: 3,
      start: { x: 155, y: 145 }, goal: { x: 862, y: 526 },
      terrain: [{ x: 110, y: 574, w: 220, h: 92 }, { x: 895, y: 584, w: 210, h: 72 }],
      initial: [plank('starter-1', 241, 271, 290, 18)],
      example: [plank('ex-1', 241, 271, 290, 18), plank('ex-2', 510, 356, 290, 18), plank('ex-3', 738, 429, 210, 18)] },
    { id: 'air-mail', name: '飞过去', tag: '弹射实验', title: '路不够？那就飞过去。',
      description: '这里没有现成的桥。试试弹簧和风扇，让小球飞过中间的障碍。',
      hint: '弹簧朝向决定弹射方向。让弹簧略微向右倾，再用风扇修正路线。', budget: 8, par: 3,
      start: { x: 156, y: 182 }, goal: { x: 860, y: 526 },
      terrain: [{ x: 110, y: 574, w: 220, h: 92 }, { x: 500, y: 550, w: 82, h: 140 }, { x: 895, y: 584, w: 210, h: 72 }],
      initial: [spring('starter-2', 160, 414, 20, 650)],
      example: [spring('ex-21', 160, 414, 30, 825), fan('ex-22', 315, 230, 0, 1000)] },
    { id: 'return-to-sender', name: '反着来', tag: '逆向思考', title: '换个方向，也能抵达。',
      description: '这次小球从右边出发。旋转零件，把你的发明反过来试试。',
      hint: '风扇吹向箭头所指方向。选中它，按 Q / E，或使用下面的旋转按钮。', budget: 8, par: 3,
      start: { x: 845, y: 135 }, goal: { x: 138, y: 526 },
      terrain: [{ x: 105, y: 584, w: 210, h: 72 }, { x: 890, y: 574, w: 220, h: 92 }],
      initial: [plank('starter-3', 759, 261, 290, -18)],
      example: [plank('ex-31', 759, 261, 290, -18), plank('ex-32', 490, 346, 290, -18), plank('ex-33', 262, 419, 210, -18)] }
  ];
});
