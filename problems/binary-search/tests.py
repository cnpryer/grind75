from solution import search


def test_found_middle():
    assert search([-1, 0, 3, 5, 9, 12], 9) == 4


def test_not_found():
    assert search([-1, 0, 3, 5, 9, 12], 2) == -1


def test_single_element_present():
    assert search([5], 5) == 0


def test_single_element_absent():
    assert search([5], 3) == -1


def test_target_at_first_index():
    assert search([-1, 0, 3, 5, 9, 12], -1) == 0


def test_target_at_last_index():
    assert search([-1, 0, 3, 5, 9, 12], 12) == 5


def test_target_below_range():
    assert search([1, 2, 3, 4, 5], -100) == -1


def test_target_above_range():
    assert search([1, 2, 3, 4, 5], 100) == -1
