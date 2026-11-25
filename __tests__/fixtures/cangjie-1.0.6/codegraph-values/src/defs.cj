package engineering
public const LIMIT: Int64 = 8
public func handler(value: Int64): Int64 { value + LIMIT }
public func recursive(value: Int64): Int64 {
    if (value <= 0) { return 0 }
    recursive(value - 1)
}
