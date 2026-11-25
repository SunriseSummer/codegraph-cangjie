package codegraph_sync.core

public func normalize(value: Float64, lower: Float64, upper: Float64): Float64 {
    (value - lower) / (upper - lower)
}
