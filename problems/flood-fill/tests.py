from solution import flood_fill


def test_classic_example():
    image = [[1, 1, 1], [1, 1, 0], [1, 0, 1]]
    assert flood_fill(image, 1, 1, 2) == [[2, 2, 2], [2, 2, 0], [2, 0, 1]]


def test_new_color_matches_source_is_noop():
    image = [[0, 0, 0], [0, 0, 0]]
    assert flood_fill(image, 0, 0, 0) == [[0, 0, 0], [0, 0, 0]]


def test_single_pixel_region():
    image = [[0, 1, 0], [1, 1, 1], [0, 1, 0]]
    # Starting on a 0 that has no same-colored orthogonal neighbors.
    assert flood_fill(image, 0, 0, 9) == [[9, 1, 0], [1, 1, 1], [0, 1, 0]]


def test_does_not_cross_diagonals():
    image = [[1, 0, 1], [0, 1, 0], [1, 0, 1]]
    # Only the center cell matches; diagonals must not connect.
    assert flood_fill(image, 1, 1, 5) == [[1, 0, 1], [0, 5, 0], [1, 0, 1]]


def test_fills_entire_grid_when_uniform():
    image = [[7, 7], [7, 7]]
    assert flood_fill(image, 0, 0, 3) == [[3, 3], [3, 3]]


def test_leaves_disjoint_regions_untouched():
    image = [
        [1, 1, 0, 2],
        [1, 1, 0, 2],
        [0, 0, 0, 2],
    ]
    # Filling the 1-region from (0,0) must leave the disjoint 2-region alone.
    assert flood_fill(image, 0, 0, 9) == [
        [9, 9, 0, 2],
        [9, 9, 0, 2],
        [0, 0, 0, 2],
    ]
