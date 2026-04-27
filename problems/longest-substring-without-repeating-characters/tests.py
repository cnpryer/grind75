from solution import length_of_longest_substring


def test_example_1():
    assert length_of_longest_substring("abcabcbb") == 3


def test_example_2():
    assert length_of_longest_substring("bbbbb") == 1


def test_example_3():
    assert length_of_longest_substring("pwwkew") == 3


def test_empty():
    assert length_of_longest_substring("") == 0


def test_single_char():
    assert length_of_longest_substring("a") == 1


def test_all_unique():
    assert length_of_longest_substring("abcdef") == 6


def test_with_spaces_and_symbols():
    assert length_of_longest_substring(" !@# !@") == 4


def test_repeats_far_apart():
    assert length_of_longest_substring("abba") == 2


def test_window_resets_correctly():
    assert length_of_longest_substring("dvdf") == 3


def test_long_run_then_unique():
    assert length_of_longest_substring("aaabcde") == 5
