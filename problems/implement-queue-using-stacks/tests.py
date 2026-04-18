from solution import MyQueue


def test_push_peek_pop():
    q = MyQueue()
    q.push(1)
    q.push(2)
    assert q.peek() == 1
    assert q.pop() == 1
    assert q.empty() is False


def test_empty_initially():
    assert MyQueue().empty() is True


def test_empty_after_draining():
    q = MyQueue()
    q.push(1)
    q.pop()
    assert q.empty() is True


def test_interleaved_push_pop_preserves_order():
    q = MyQueue()
    q.push(1)
    assert q.pop() == 1
    q.push(2)
    q.push(3)
    assert q.pop() == 2
    q.push(4)
    assert q.pop() == 3
    assert q.pop() == 4
    assert q.empty() is True


def test_peek_does_not_mutate():
    q = MyQueue()
    q.push(5)
    q.push(6)
    assert q.peek() == 5
    assert q.peek() == 5
    assert q.pop() == 5
    assert q.peek() == 6


def test_fifo_order_over_many_pushes():
    q = MyQueue()
    for i in range(10):
        q.push(i)
    assert [q.pop() for _ in range(10)] == list(range(10))
    assert q.empty() is True
