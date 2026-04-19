from solution import valid_parentheses


def test_simple_pair():
    assert valid_parentheses("()") is True


def test_all_three_kinds():
    assert valid_parentheses("()[]{}") is True


def test_nested():
    assert valid_parentheses("{[]}") is True


def test_mismatched_kinds():
    assert valid_parentheses("(]") is False


def test_crossed_nesting():
    assert valid_parentheses("([)]") is False


def test_empty_string_is_balanced():
    assert valid_parentheses("") is True


def test_lone_opener():
    assert valid_parentheses("(") is False


def test_lone_closer():
    assert valid_parentheses(")") is False
