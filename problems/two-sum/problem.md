# Two Sum

Given an array of integers `nums` and an integer `target`, return the indices
of the two numbers that add up to `target`.

You may assume that each input has **exactly one solution**, and you may not
use the same element twice.

You can return the answer in any order.

## Examples

```
Input:  nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
Explanation: nums[0] + nums[1] == 9
```

```
Input:  nums = [3, 2, 4], target = 6
Output: [1, 2]
```

```
Input:  nums = [3, 3], target = 6
Output: [0, 1]
```

## Constraints

- `2 <= len(nums) <= 10_000`
- `-10**9 <= nums[i] <= 10**9`
- `-10**9 <= target <= 10**9`
- Exactly one valid answer exists.

## Hints

- The brute-force `O(n²)` pair scan is obvious — can you do it in one pass?
- If you've seen `target - nums[i]` before, you already have your pair.
