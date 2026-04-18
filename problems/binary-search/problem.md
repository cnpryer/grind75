# Binary Search

Given a **sorted** array of distinct integers `nums` and an integer `target`,
return the index of `target` in `nums`. If `target` is not present, return
`-1`.

Your solution must run in `O(log n)`.

## Examples

```
Input:  nums = [-1, 0, 3, 5, 9, 12], target = 9
Output: 4
```

```
Input:  nums = [-1, 0, 3, 5, 9, 12], target = 2
Output: -1
```

```
Input:  nums = [5], target = 5
Output: 0
```

## Constraints

- `1 <= len(nums) <= 10_000`
- `-10**4 <= nums[i], target <= 10**4`
- All integers in `nums` are unique and sorted in ascending order.

## Hints

- Two pointers `lo` and `hi` that close in on the target.
- Use `mid = lo + (hi - lo) // 2` to avoid overflow in languages where it matters
  (Python is fine, but it's still good form).
- Returning `-1` when the range collapses (`lo > hi`) is the termination signal.
