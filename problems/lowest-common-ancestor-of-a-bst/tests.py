from solution import TreeNode, lowest_common_ancestor


def build_sample_bst() -> tuple[TreeNode, dict[int, TreeNode]]:
    """Build the canonical problem tree and return (root, {val: node})."""
    nodes = {v: TreeNode(v) for v in (0, 2, 3, 4, 5, 6, 7, 8, 9)}
    nodes[6].left = nodes[2]
    nodes[6].right = nodes[8]
    nodes[2].left = nodes[0]
    nodes[2].right = nodes[4]
    nodes[4].left = nodes[3]
    nodes[4].right = nodes[5]
    nodes[8].left = nodes[7]
    nodes[8].right = nodes[9]
    return nodes[6], nodes


def test_split_at_root():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[2], nodes[8]).val == 6


def test_ancestor_is_one_of_nodes():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[2], nodes[4]).val == 2


def test_both_in_left_subtree():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[0], nodes[3]).val == 2


def test_both_in_right_subtree():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[7], nodes[9]).val == 8


def test_root_is_one_of_nodes():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[6], nodes[9]).val == 6


def test_deep_split():
    root, nodes = build_sample_bst()
    assert lowest_common_ancestor(root, nodes[3], nodes[5]).val == 4
