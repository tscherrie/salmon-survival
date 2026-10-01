// Hand-placed pixels for the smallest tiles, in canvas px. `b14` is the Windows/Linux 16 px tile (14 px body at
// 1..14); `win20` is the 20 px Windows tile (18 px body at 1..18, 125 % small icon).
// One strong silhouette each: a Daylight tag with a pixel-drawn "1" (stem, flag, foot) on a 1-px post, the rule,
// and the Tungsten playhead with its cap. Margins are equal left and right, with a dark gap between tag and cap
// and between the cap and the rim. The drop line is left out at 16 px; at 20 px it is two 1-px dashes.
// `mac16` is the macOS 16@1x entry (ic04) on Apple's grid: a 13-px body (824/1024 x 16 = 12.9) at 1..13, the same
// 13 pt as the 16@2x entry (26 px body), so Finder lists, the sidebar and Spotlight show it at system-icon size.
// Its 5 x 5 tag is too small for a legible numeral (3 px tall reads as "7" or "4"), so it is a solid Daylight tag on a
// post: the strongest silhouette at this size. Equal margins: rim 1, gap, tag 3..7, gap 8, cap 9..11, gap 12, rim 13.
module.exports = {
  mac16: {
    rule: [-1, 9, 17, 10],                              // row 9 (master: rule at 61 % of the body)
    tag: [3, 3, 8, 8], tagR: 0.75, lip: 0,              // 5 x 5, columns 3..7, rows 3..7
    post: [5, 8, 6, 9],                                 // column 5, row 8
    drop: [],
    num: [],
    ph: [10, 3, 11, 13],                                // line column 10, rows 3..12 (1 px inside the rim)
    capPx: [[9, 3, 3, 2]],                              // columns 9..11, rows 3..4, top-aligned with the tag
  },
  b14: {
    rule: [-1, 11, 17, 12],
    tag: [3, 3, 9, 9], tagR: 1, lip: 0,                 // 6 x 6, columns 3..8 (margin 2 incl. rim)
    post: [6, 9, 7, 11],
    drop: [],
    num: [[6, 4, 1, 4], [5, 5, 1, 1], [5, 7, 1, 1], [7, 7, 1, 1]],
    ph: [11, 3, 12, 14],                                // line column 11, stops 1 px inside the body
    capPx: [[10, 3, 3, 2]],                             // columns 10..12, then dark 13, rim 14
  },
  win20: {
    rule: [-1, 12, 21, 13],
    tag: [4, 4, 11, 10], tagR: 1, lip: 0,               // 7 x 6, columns 4..10, centred post at 7
    post: [7, 10, 8, 12],
    drop: [[7, 14, 8, 15], [7, 16, 8, 17]],
    num: [[7, 5, 1, 4], [6, 6, 1, 1], [6, 8, 1, 1], [8, 8, 1, 1]],
    ph: [14, 4, 15, 18],
    capPx: [[13, 4, 3, 3]],                             // columns 13..15, margin 16..18 (3) = left 1..3 (3)
  },
};
