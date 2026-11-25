package engineering

main(): Int64 {
    let total = readGlobal() + parameterCallback(handler)
    println("values: ${total}")
    localCallback()
    recursive(3)
    return 0
}
