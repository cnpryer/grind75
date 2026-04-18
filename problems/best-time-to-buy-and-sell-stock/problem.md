# Best Time to Buy and Sell Stock

You are given an array `prices` where `prices[i]` is the price of a stock on
day `i`. You may buy on one day and sell on a later day. Return the maximum
profit you can achieve. If no profitable trade exists, return `0`.

You cannot sell before you buy, and you complete at most one transaction.

## Examples

```
Input:  [7, 1, 5, 3, 6, 4]
Output: 5
Explanation: Buy on day 2 (price = 1) and sell on day 5 (price = 6).
```

```
Input:  [7, 6, 4, 3, 1]
Output: 0
Explanation: Prices only fall — no profitable transaction.
```

```
Input:  [2, 4, 1]
Output: 2
```

## Constraints

- `1 <= len(prices) <= 100_000`
- `0 <= prices[i] <= 10_000`

## Hints

- Track the minimum price seen so far while sweeping left-to-right.
- At each day, the best sale-today profit is `price - min_so_far`.
- Keep the running max of that quantity — that's your answer.
