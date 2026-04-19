from collections import deque

from solution import TreeNode, is_balanced


def from_level_order(values: list[int | None]) -> TreeNode | None:
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


def test_balanced_example():
    assert is_balanced(from_level_order([3, 9, 20, None, None, 15, 7])) is True


def test_unbalanced_left_heavy():
    assert is_balanced(from_level_order([1, 2, 2, 3, 3, None, None, 4, 4])) is False


def test_empty_tree_is_balanced():
    assert is_balanced(None) is True


def test_single_node_is_balanced():
    assert is_balanced(TreeNode(1)) is True


def test_left_chain_two_deep_is_balanced():
    # root -> left -> left: left subtree height 2, right 0, diff 2 → unbalanced at root.
    root = TreeNode(1, TreeNode(2, TreeNode(3)))
    assert is_balanced(root) is False


def test_root_ok_but_subtree_unbalanced():
    # Left and right subtrees have equal heights from the root, but the left
    # subtree itself is internally unbalanced — solution must recurse.
    left = TreeNode(2, TreeNode(3, TreeNode(4)))
    right = TreeNode(2, TreeNode(3))
    assert is_balanced(TreeNode(1, left, right)) is False


def test_perfect_tree_is_balanced():
    assert is_balanced(from_level_order([1, 2, 3, 4, 5, 6, 7])) is True
