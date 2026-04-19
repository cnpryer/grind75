# Merge Two Sorted Lists

You are given the heads of two sorted singly-linked lists `l1` and `l2`.
Merge them into a single sorted list by splicing together the existing nodes.
Return the head of the merged list.

A linked-list node is defined as:

```python
from __future__ import annotations


class ListNode:
    def __init__(self, val: int = 0, next: ListNode | None = None):
        self.val = val
        self.next = next
```

An empty list is represented by `None`.

## Examples

```
Input:  l1 = 1 → 2 → 4, l2 = 1 → 3 → 4
Output: 1 → 1 → 2 → 3 → 4 → 4
```

```
Input:  l1 = None, l2 = None
Output: None
```

```
Input:  l1 = None, l2 = 0
Output: 0
```

## Constraints

- `0 <= len(l1), len(l2) <= 50`
- `-100 <= node.val <= 100`
- Both lists are sorted in non-decreasing order.

## Hints

- A sentinel "dummy" head simplifies the join: `dummy.next` becomes your result.
- Walk both lists with a single cursor `tail`, splicing the smaller head each step.
- When one list runs out, attach the other's remaining tail wholesale.
