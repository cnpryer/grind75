# Balanced Binary Tree

Given the root of a binary tree, return `True` if it is **height-balanced**
and `False` otherwise.

A binary tree is height-balanced when, for every node, the heights of its
left and right subtrees differ by at most 1.

A tree node is:

```python
class TreeNode:
    def __init__(self, val: int = 0, left: "TreeNode | None" = None, right: "TreeNode | None" = None):
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

- `0 <= number of nodes <= 5_000`
- `-10**4 <= node.val <= 10**4`

## Hints

- The naive "compute height at every node" is `O(n²)`.
- A single post-order DFS can return height and signal imbalance in one pass —
  use a sentinel (e.g., `-1`) to bubble "unbalanced" up without extra state.
- Height of `None` is `0` by convention.
