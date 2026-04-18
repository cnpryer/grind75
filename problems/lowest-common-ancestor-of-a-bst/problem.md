# Lowest Common Ancestor of a BST

Given the root of a **binary search tree** and two nodes `p` and `q` that
both exist in the tree, return their lowest common ancestor (LCA).

The LCA of two nodes `p` and `q` is the lowest node in the tree that has
both `p` and `q` as descendants (where a node is its own descendant).

A tree node is:

```python
class TreeNode:
    def __init__(self, val: int = 0, left: "TreeNode | None" = None, right: "TreeNode | None" = None):
        self.val = val
        self.left = left
        self.right = right
```

All node values are unique; `p != q` and both exist in the tree.

## Examples

```
Tree:        6
           /   \
          2     8
         / \   / \
        0   4 7   9
           / \
          3   5

Input:  p = 2, q = 8
Output: 6

Input:  p = 2, q = 4
Output: 2   (a node is its own descendant)
```

## Constraints

- `2 <= number of nodes <= 10_000`
- All `node.val` are unique; tree obeys the BST invariant.

## Hints

- BST order means you don't need a general LCA search — compare values.
- Walk from the root: go left if both targets are smaller, right if both are
  larger, otherwise you've split them — the current node is the LCA.
- This is `O(h)` time and `O(1)` space; no recursion needed.
