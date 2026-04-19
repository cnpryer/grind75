from collections import deque

from solution import TreeNode, invert_tree


def from_level_order(values: list[int | None]) -> TreeNode | None:
    """Build a tree from a LeetCode-style level-order list (None = missing child)."""
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = deque([root])
    i = 1
    while queue and i < len(values):
        node = queue.popleft()
        if i < len(values) and values[i] is not None:
            node.left = TreeNode(values[i])
            queue.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = TreeNode(values[i])
            queue.append(node.right)
        i += 1
    return root


def to_level_order(root: TreeNode | None) -> list[int | None]:
    if root is None:
        return []
    out: list[int | None] = []
    queue: deque[TreeNode | None] = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            out.append(None)
            continue
        out.append(node.val)
        queue.append(node.left)
        queue.append(node.right)
    while out and out[-1] is None:
        out.pop()
    return out


def test_classic_example():
    root = from_level_order([4, 2, 7, 1, 3, 6, 9])
    assert to_level_order(invert_tree(root)) == [4, 7, 2, 9, 6, 3, 1]


def test_empty_tree_returns_none():
    assert invert_tree(None) is None


def test_single_node_unchanged():
    root = TreeNode(1)
    inverted = invert_tree(root)
    assert inverted is root
    assert inverted.left is None
    assert inverted.right is None


def test_left_only_tree():
    root = from_level_order([1, 2])
    assert to_level_order(invert_tree(root)) == [1, None, 2]


def test_right_only_tree():
    root = from_level_order([1, None, 2])
    assert to_level_order(invert_tree(root)) == [1, 2]


def test_inversion_is_self_inverse():
    values = [4, 2, 7, 1, 3, 6, 9]
    root = from_level_order(values)
    inverted_twice = invert_tree(invert_tree(root))
    assert to_level_order(inverted_twice) == values
