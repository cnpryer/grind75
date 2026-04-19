from __future__ import annotations


class ListNode:
    def __init__(self, val: int = 0, next: ListNode | None = None):
        self.val = val
        self.next = next


def has_cycle(head: ListNode | None) -> bool:
    raise NotImplementedError
