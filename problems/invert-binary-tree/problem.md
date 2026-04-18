# Invert Binary Tree

Given the root of a binary tree, invert it in place (swap every node's left
and right child) and return the root.

A tree node is defined as:

```python
class TreeNode:
    def __init__(self, val: int = 0, left: "TreeNode | None" = None, right: "TreeNode | None" = None):
        self.val = val
        self.left = left
        self.right = right
```

An empty tree is represented by `None`.

## Examples

```
Input:       4
           /   \
          2     7
         / \   / \
        1   3 6   9

Output:      4
           /   \
          7     2
         / \   / \
        9   6 3   1
```

```
Input:  None
Output: None
```

## Constraints

- `0 <= number of nodes <= 1_000`
- `-100 <= node.val <= 100`

## Hints

- Recursion is natural: invert both subtrees, then swap them.
- An iterative version uses a queue or stack — each iteration swaps a node's
  children and enqueues them.
- Don't forget the `None` base case.
