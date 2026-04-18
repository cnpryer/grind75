from solution import ListNode, merge_two_sorted_lists


def to_list(head: ListNode | None) -> list[int]:
    out: list[int] = []
    while head is not None:
        out.append(head.val)
        head = head.next
    return out


def from_list(values: list[int]) -> ListNode | None:
    dummy = ListNode()
    tail = dummy
    for v in values:
        tail.next = ListNode(v)
        tail = tail.next
    return dummy.next


def test_classic_merge():
    l1 = from_list([1, 2, 4])
    l2 = from_list([1, 3, 4])
    assert to_list(merge_two_sorted_lists(l1, l2)) == [1, 1, 2, 3, 4, 4]


def test_both_empty():
    assert merge_two_sorted_lists(None, None) is None


def test_first_empty():
    l2 = from_list([0])
    assert to_list(merge_two_sorted_lists(None, l2)) == [0]


def test_second_empty():
    l1 = from_list([1, 2, 3])
    assert to_list(merge_two_sorted_lists(l1, None)) == [1, 2, 3]


def test_disjoint_ranges():
    l1 = from_list([1, 2, 3])
    l2 = from_list([4, 5, 6])
    assert to_list(merge_two_sorted_lists(l1, l2)) == [1, 2, 3, 4, 5, 6]


def test_all_duplicates():
    l1 = from_list([2, 2, 2])
    l2 = from_list([2, 2])
    assert to_list(merge_two_sorted_lists(l1, l2)) == [2, 2, 2, 2, 2]


def test_negative_values():
    l1 = from_list([-5, -2, 0])
    l2 = from_list([-3, -1, 1])
    assert to_list(merge_two_sorted_lists(l1, l2)) == [-5, -3, -2, -1, 0, 1]
