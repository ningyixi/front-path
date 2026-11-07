/**
 * Front Path — handcrafted levels (all solvable).
 * Cell coords: (0,0) top-left. Directions: U D L R.
 * Rule: an arrow slides in its facing direction off the board
 * only if no other arrow sits on that ray.
 */
(function (root) {
  const D = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

  const LEVELS = [
    {
      id: 1,
      name: 'Warm-up',
      w: 4,
      h: 4,
      // Rightmost must leave first
      arrows: [
        { x: 1, y: 1, d: 'R' },
        { x: 2, y: 1, d: 'R' },
      ],
    },
    {
      id: 2,
      name: 'Turn',
      w: 4,
      h: 4,
      // Clear bottom exit, then the column, then the row
      arrows: [
        { x: 0, y: 1, d: 'R' },
        { x: 1, y: 1, d: 'R' },
        { x: 2, y: 1, d: 'D' },
        { x: 2, y: 2, d: 'R' },
      ],
    },
    {
      id: 3,
      name: 'Gate',
      w: 5,
      h: 5,
      arrows: [
        { x: 1, y: 0, d: 'D' },
        { x: 1, y: 1, d: 'D' },
        { x: 1, y: 2, d: 'R' },
        { x: 2, y: 2, d: 'R' },
        { x: 3, y: 2, d: 'D' },
        { x: 3, y: 3, d: 'R' },
      ],
    },
    {
      id: 4,
      name: 'Fork',
      w: 5,
      h: 5,
      arrows: [
        { x: 0, y: 1, d: 'R' },
        { x: 1, y: 1, d: 'R' },
        { x: 2, y: 1, d: 'D' },
        { x: 2, y: 2, d: 'L' },
        { x: 1, y: 2, d: 'D' },
        { x: 1, y: 3, d: 'R' },
        { x: 2, y: 3, d: 'R' },
        { x: 3, y: 3, d: 'U' },
        { x: 3, y: 2, d: 'U' },
        { x: 3, y: 1, d: 'R' },
      ],
    },
    {
      id: 5,
      name: 'Rush',
      w: 6,
      h: 6,
      // Unwind from the south exit of column 5
      arrows: [
        { x: 0, y: 1, d: 'R' },
        { x: 1, y: 1, d: 'R' },
        { x: 2, y: 1, d: 'R' },
        { x: 3, y: 1, d: 'D' },
        { x: 3, y: 2, d: 'D' },
        { x: 3, y: 3, d: 'L' },
        { x: 2, y: 3, d: 'L' },
        { x: 1, y: 3, d: 'D' },
        { x: 1, y: 4, d: 'R' },
        { x: 2, y: 4, d: 'R' },
        { x: 3, y: 4, d: 'R' },
        { x: 4, y: 4, d: 'U' },
        { x: 4, y: 3, d: 'U' },
        { x: 4, y: 2, d: 'R' },
        { x: 5, y: 2, d: 'D' },
        { x: 5, y: 3, d: 'D' },
        { x: 5, y: 4, d: 'D' },
      ],
    },
  ];

  root.FrontPathLevels = { LEVELS, D };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
