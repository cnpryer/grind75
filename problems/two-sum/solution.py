def two_sum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for i, n in enumerate(nums):
        complement = target - n
        if complement in seen:
            return [seen[complement], i]
        seen[n] = i
    raise ValueError("no pair sums to target")
