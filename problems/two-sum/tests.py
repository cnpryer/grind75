from solution import two_sum


def test_example_1():
    assert sorted(two_sum([2, 7, 11, 15], 9)) == [0, 1]


def test_example_2():
    assert sorted(two_sum([3, 2, 4], 6)) == [1, 2]


def test_duplicates():
    assert sorted(two_sum([3, 3], 6)) == [0, 1]


def test_negatives_and_zero():
    assert sorted(two_sum([-3, 4, 3, 90], 0)) == [0, 2]


def test_negative_target():
    assert sorted(two_sum([-1, -2, -3, -4], -7)) == [2, 3]


def test_end_of_array():
    assert sorted(two_sum([1, 2, 3, 4, 5], 9)) == [3, 4]
