# Flood Fill

You are given an `m x n` `image` of integers, plus a starting pixel
`(sr, sc)` and a replacement `color`. Perform a flood fill:

- Beginning at `image[sr][sc]`, replace every connected pixel (up/down/left/right)
  whose color equals the original starting color with `color`.
- Diagonal neighbors are **not** connected.
- Do not recolor pixels that don't match the original starting color.

Return the modified image. Mutating `image` in place and returning it is fine.

## Examples

```
Input:  image = [[1,1,1],
                 [1,1,0],
                 [1,0,1]], sr = 1, sc = 1, color = 2
Output:         [[2,2,2],
                 [2,2,0],
                 [2,0,1]]
```

```
Input:  image = [[0,0,0],
                 [0,0,0]], sr = 0, sc = 0, color = 0
Output:         [[0,0,0],
                 [0,0,0]]
Explanation: New color equals old — no change.
```

## Constraints

- `1 <= m, n <= 50`
- `0 <= image[i][j], color < 2**16`

## Hints

- Iterative BFS/DFS with a stack or queue avoids Python's recursion limits.
- Snapshot the **starting** color before you change anything — otherwise the
  recursion will short-circuit once the source pixel is recolored.
- Early-exit when the new color equals the source color.
