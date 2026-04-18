# Implement Queue using Stacks

Implement a first-in-first-out (FIFO) queue using only two stacks (Python lists
restricted to `append` and `pop`). The queue must support:

- `push(x)` — push `x` onto the back of the queue.
- `pop()` — remove and return the element at the front of the queue.
- `peek()` — return the element at the front without removing it.
- `empty()` — return `True` if the queue has no elements.

Each operation should be `O(1)` amortized.

## Examples

```
q = MyQueue()
q.push(1)
q.push(2)
q.peek()    # 1
q.pop()     # 1
q.empty()   # False
```

## Constraints

- `1 <= x <= 10**9`
- At most `1_000` calls across `push`, `pop`, `peek`, `empty`.
- `pop` and `peek` are only called on a non-empty queue.

## Hints

- Use two stacks: `in_stack` accepts pushes; `out_stack` serves pops.
- When `out_stack` is empty and you need to pop/peek, drain `in_stack` into
  `out_stack` — order reverses, so the oldest push is now on top.
- Each element moves from `in_stack` to `out_stack` at most once, so the
  amortized cost is `O(1)`.
