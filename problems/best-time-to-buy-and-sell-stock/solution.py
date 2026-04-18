def max_profit(prices: list[int]) -> int:
    best = 0
    min_so_far = float("inf")
    for p in prices:
        if p < min_so_far:
            min_so_far = p
        elif p - min_so_far > best:
            best = p - min_so_far
    return best
