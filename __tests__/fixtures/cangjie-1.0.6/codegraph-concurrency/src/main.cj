package codegraph_concurrency

import std.sync.Mutex

public class GuardedCounter {
    private let mutex = Mutex()
    public var total: Int64 = 0
    public init() {}
    public func addOne(): Unit {
        synchronized(mutex) { total++ }
    }
    public func addMany(count: Int64): Unit {
        for (_ in 0..count) { this.addOne() }
    }
}

public func addMany(counter: GuardedCounter, count: Int64): Unit {
    for (_ in 0..count) { counter.addOne() }
}

main(): Int64 {
    let counter = GuardedCounter()
    let task = spawn { addMany(counter, 3) }
    counter.addMany(2)
    task.get()
    println("concurrency: ${counter.total}")
    return 0
}
