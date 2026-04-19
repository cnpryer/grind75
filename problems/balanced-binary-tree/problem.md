# Balanced Binary Tree

Given the root of a binary tree, return `True` if it is **height-balanced**
and `False` otherwise.

A binary tree is height-balanced when, for every node, the heights of its
left and right subtrees differ by at most 1.

A tree node is:

```python
from __future__ import annotations


class TreeNode:
    def __init__(self, val: int = 0, left: TreeNode | None = None, right: TreeNode | None = None):
        self.val = val
        self.left = left
        self.right = right
```

## Examples

```
Input:       3
           /   \
          9    20
              /  \
             15   7
Output: True
```

```
Input:           1
               /   \
              2     2
             / \
            3   3
           / \
          4   4
Output: False
Explanation: The left subtree is unbalanced — heights 3 vs 0.
```

```
Input:  None
Output: True
```

## Constraints

- `0 <= number of nodes <= 1_000`
- `-10**4 <= node.val <= 10**4`

> Note: LeetCode allows up to 5,000 nodes here. The constraint is tightened
> for grind75 because the canonical solution is a post-order DFS, and a
> highly skewed tree of more than ~1,000 nodes would exceed Python's default
> recursion limit. If you reach for an iterative explicit-stack version,
> the higher bound is fine — but the recursive answer is the one that
> matters for interviews.

## Hints

- The naive "compute height at every node" is `O(n²)`.
- A single post-order DFS can return height and signal imbalance in one pass —
  use a sentinel (e.g., `-1`) to bubble "unbalanced" up without extra state.
- Height of `None` is `0` by convention.
