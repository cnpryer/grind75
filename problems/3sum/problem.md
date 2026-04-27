# 3Sum

Given an integer array `nums`, return all unique triplets `[nums[i], nums[j], nums[k]]`
such that `i != j`, `i != k`, `j != k`, and `nums[i] + nums[j] + nums[k] == 0`.

The solution set must not contain duplicate triplets. Triplets and the overall
result list may be returned in any order.

## Examples

```
Input:  nums = [-1, 0, 1, 2, -1, -4]
Output: [[-1, -1, 2], [-1, 0, 1]]
```

```
Input:  nums = [0, 1, 1]
Output: []
```

```
Input:  nums = [0, 0, 0]
Output: [[0, 0, 0]]
```

## Constraints

- `3 <= len(nums) <= 3000`
- `-10**5 <= nums[i] <= 10**5`

## Hints

- Sorting first lets you skip duplicates and use a two-pointer sweep.
- Fix one index `i`, then find pairs in the remaining slice that sum to `-nums[i]`.
- After advancing a pointer, skip over equal neighbors to avoid duplicate triplets.
