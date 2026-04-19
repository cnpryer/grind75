# Linked List Cycle

Given the head of a singly-linked list, return `True` if the list contains a
cycle and `False` otherwise.

A cycle occurs when some node's `next` pointer re-enters a node earlier in
the list, creating a loop.

A linked-list node is:

```python
from __future__ import annotations


class ListNode:
    def __init__(self, val: int = 0, next: ListNode | None = None):
        self.val = val
        self.next = next
```

## Examples

```
Input:  1 → 2 → 3 → 4 → (back to node at index 1)
Output: True
```

```
Input:  1 → 2
Output: False
```

```
Input:  None
Output: False
```

## Constraints

- `0 <= number of nodes <= 10_000`
- `-10**5 <= node.val <= 10**5`

## Hints

- Floyd's tortoise-and-hare: two cursors advancing at different speeds will
  always meet inside a cycle.
- Using `O(n)` extra memory (a set of seen nodes) also works and is easier
  to write — the `O(1)`-space version is the interesting one.
- Handle `None` and single-node lists explicitly.
