from solution import ListNode, has_cycle


def from_list_with_cycle(values: list[int], pos: int) -> ListNode | None:
    """Build a linked list; if `pos >= 0` the tail.next points at nodes[pos]."""
    if not values:
        return None
    nodes = [ListNode(v) for v in values]
    for i in range(len(nodes) - 1):
        nodes[i].next = nodes[i + 1]
    if pos >= 0:
        nodes[-1].next = nodes[pos]
    return nodes[0]


def test_empty_list():
    assert has_cycle(None) is False


def test_single_node_no_cycle():
    assert has_cycle(ListNode(1)) is False


def test_single_node_self_cycle():
    node = ListNode(1)
    node.next = node
    assert has_cycle(node) is True


def test_no_cycle_longer_list():
    assert has_cycle(from_list_with_cycle([1, 2, 3, 4], -1)) is False


def test_cycle_back_to_middle():
    assert has_cycle(from_list_with_cycle([3, 2, 0, -4], 1)) is True


def test_cycle_back_to_head():
    assert has_cycle(from_list_with_cycle([1, 2], 0)) is True


def test_two_node_no_cycle():
    assert has_cycle(from_list_with_cycle([1, 2], -1)) is False
