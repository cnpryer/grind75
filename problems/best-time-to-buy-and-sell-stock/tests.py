from solution import max_profit


def test_classic_example():
    assert max_profit([7, 1, 5, 3, 6, 4]) == 5


def test_strictly_decreasing_returns_zero():
    assert max_profit([7, 6, 4, 3, 1]) == 0


def test_two_day_profit():
    assert max_profit([2, 4, 1]) == 2


def test_single_day_returns_zero():
    assert max_profit([5]) == 0


def test_all_equal_returns_zero():
    assert max_profit([3, 3, 3, 3]) == 0


def test_late_dip_sets_new_min():
    # Best trade is buy at 1 (index 3), sell at 5 (index 4) → profit 4,
    # beating the early 6→8 window of 2. Make sure a post-peak minimum
    # still sets up a winning sale.
    assert max_profit([6, 8, 3, 1, 5]) == 4


def test_monotonic_increase():
    assert max_profit([1, 2, 3, 4, 5]) == 4
