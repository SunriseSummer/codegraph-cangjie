#include <tree_sitter/parser.h>
#include <wctype.h>
#include <string.h>
#include <stdio.h>

// 定义一个宏来控制是否启用调试
#define DEBUG_SCANNER 0

enum TokenType {
  _MULTI_LINE_RAW_STRING_START,
  _MULTI_LINE_RAW_STRING_CONTENT,
  _MULTI_LINE_RAW_STRING_END,
  _NEWLINE,
  BLOCK_COMMENT,
};

typedef struct {
  bool in_string;            // Whether we're currently inside a string
  uint8_t delimiter_length;  // Number of '#' characters in current delimiter
  uint8_t quote_char;        // Quote character used: '"' or '\''
} Scanner;

#if DEBUG_SCANNER
static FILE* log_file = NULL;
static void logger(TSLexer* lexer, const char* msg) {
  (void)lexer;
  if (log_file == NULL) {
    fputs(msg, stdout);
    return;
  }
  fputs(msg, log_file);
  fflush(log_file);
}
#endif

// ----------------------------------------------------------
// Utility Functions
// ----------------------------------------------------------

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static void skip(TSLexer *lexer) {
  lexer->advance(lexer, true);
}

// ----------------------------------------------------------
// Scanner Lifecycle Functions
// ----------------------------------------------------------

void *tree_sitter_cangjie_external_scanner_create() {
#if DEBUG_SCANNER
  log_file = fopen("/home/yxm/tree-sitter-cangjie.log", "a+");
#endif
  Scanner *scanner = calloc(1, sizeof(Scanner));
  if (scanner == NULL) return NULL;
  scanner->delimiter_length = 0;
  scanner->in_string = false;
  scanner->quote_char = 0;
  return scanner;
}

void tree_sitter_cangjie_external_scanner_destroy(void *payload) {
#if DEBUG_SCANNER
  if (log_file != NULL) {
    fclose(log_file);
    log_file = NULL;
  }
#endif
  free(payload);
}

unsigned tree_sitter_cangjie_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *scanner = (Scanner *)payload;
  buffer[0] = scanner->in_string? 1: 0;
  buffer[1] = (char)scanner->delimiter_length;
  buffer[2] = (char)scanner->quote_char;
  return 3;
}

void tree_sitter_cangjie_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = (Scanner *)payload;
  if (length >= 3) {
    scanner->in_string = buffer[0];
    scanner->delimiter_length = (uint8_t)buffer[1];
    scanner->quote_char = (uint8_t)buffer[2];
  } else {
    scanner->delimiter_length = 0;
    scanner->in_string = false;
    scanner->quote_char = 0;
  }
}

// ----------------------------------------------------------
// Delimiter Scanning Functions
// ----------------------------------------------------------

static bool scan_opening_delimiter(TSLexer *lexer, Scanner *scanner) {
  // Count the number of '#' characters
  uint8_t hash_count = 0;
  while (lexer->lookahead == '#') {
    advance(lexer);
    hash_count++;
    if (hash_count == UINT8_MAX) return false;  // Prevent overflow
  }

  // Must be followed by a quote (single or double)
  if ((lexer->lookahead != '"' && lexer->lookahead != '\'') || hash_count == 0) {
    scanner->delimiter_length = 0;
    scanner->in_string = false;
    scanner->quote_char = 0;
    return false;
  }

  scanner->quote_char = (uint8_t)lexer->lookahead;
  advance(lexer);

  // Store the delimiter length and mark as in string
  scanner->delimiter_length = hash_count;
  scanner->in_string = true;
  lexer->result_symbol = _MULTI_LINE_RAW_STRING_START;
  return true;
}

static bool scan_closing_delimiter(TSLexer *lexer, Scanner *scanner) {  
//  DEBUG_PRINT("Scanning opening delimiter, current char: '%c'\n", lexer->lookahead);

  advance(lexer);
  
  // Count the number of '#' characters
  uint8_t hash_count = 0;
  while (lexer->lookahead == '#') {
    advance(lexer);
    hash_count++;
    if (hash_count == UINT8_MAX) return false;
  }

  // Must match opening delimiter length
  if (hash_count != scanner->delimiter_length) {
    return false;
  }

  // Reset scanner state
  scanner->delimiter_length = 0;
  scanner->in_string = false;
  scanner->quote_char = 0;
  lexer->result_symbol = _MULTI_LINE_RAW_STRING_END;
  return true;
}

// ----------------------------------------------------------
// Content Scanning Function
// ----------------------------------------------------------

static bool scan_string_content(TSLexer *lexer, Scanner *scanner) {
  if (!scanner->in_string) return false;

  lexer->result_symbol = _MULTI_LINE_RAW_STRING_CONTENT;
  uint8_t quote = scanner->quote_char;

  while (true) {
    // Check for potential closing delimiter
    if (lexer->lookahead == quote) {
      lexer->mark_end(lexer); //标记内容的结束位置
      uint8_t hash_count = 0;
      advance(lexer);
      // Count the '#' characters
      while (lexer->lookahead == '#') {
        advance(lexer);
        hash_count++;
      }
      // Check if it's a valid closing delimiter
      if (hash_count == scanner->delimiter_length) {
        // Not part of the content - return what we have
        return true;
      }
    }
    // Handle EOF case
    else if (lexer->lookahead == 0) {
      lexer->mark_end(lexer);
      return true;
    } 
    // Normal content character
    else {
      advance(lexer);
    }
  }
}

// ----------------------------------------------------------
// Newline Scanning Function
// ----------------------------------------------------------

// 换行后向前看(仅前瞻,不消费 token):跳过空白与注释,判断下一个有效
// token 是否为成员访问的 `.`。若是,则该换行不应作为语句终结符,
// 以支持行首点号的链式调用(fluent/builder)风格:
//     p
//         .fill(1)
//         .stroke(2)
// 排除项:`..`/`..=` 是区间运算符,`.5` 这类以数字开头的是浮点字面量。
static bool next_token_starts_member_access(TSLexer *lexer) {
  for (;;) {
    if (iswspace(lexer->lookahead)) {
      advance(lexer);
      continue;
    }
    if (lexer->lookahead == '/') {
      advance(lexer);
      if (lexer->lookahead == '/') {
        // 行注释:吃到行尾
        while (lexer->lookahead != '\n' && lexer->lookahead != 0) {
          advance(lexer);
        }
        continue;
      }
      if (lexer->lookahead == '*') {
        // 块注释:吃到配对的 */(仓颉块注释支持嵌套,按深度计数)
        advance(lexer);
        uint32_t depth = 1;
        while (depth > 0 && lexer->lookahead != 0) {
          if (lexer->lookahead == '/') {
            advance(lexer);
            if (lexer->lookahead == '*') {
              advance(lexer);
              depth++;
            }
          } else if (lexer->lookahead == '*') {
            advance(lexer);
            if (lexer->lookahead == '/') {
              advance(lexer);
              depth--;
            }
          } else {
            advance(lexer);
          }
        }
        continue;
      }
      return false;  // 除号等其他 token
    }
    break;
  }
  if (lexer->lookahead != '.') return false;
  advance(lexer);
  if (lexer->lookahead == '.') return false;                       // `..` / `..=` 区间运算符
  if (lexer->lookahead >= '0' && lexer->lookahead <= '9') return false;  // `.5` 浮点字面量
  return true;
}

// ----------------------------------------------------------
// Main Scanning Function
// ----------------------------------------------------------

bool tree_sitter_cangjie_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;

  // In a raw string: whitespace is significant, handle content/end first
  if (scanner->in_string) {
    if (valid_symbols[_MULTI_LINE_RAW_STRING_CONTENT]) {
      return scan_string_content(lexer, scanner);
    }
    if (valid_symbols[_MULTI_LINE_RAW_STRING_END] && lexer->lookahead == scanner->quote_char) {
      return scan_closing_delimiter(lexer, scanner);
    }
    return false;
  }

  // Newline terminator: must be checked before any whitespace skipping
  if (valid_symbols[_NEWLINE]) {
    // 跳过换行之外的空白(含孤立 \r),token 本身只含 '\n'
    while (iswspace(lexer->lookahead) && lexer->lookahead != '\n') {
      skip(lexer);
    }
    if (lexer->lookahead == '\n') {
      advance(lexer);
      lexer->mark_end(lexer);  // token 到此为止,后续 advance 仅作前瞻
      if (next_token_starts_member_access(lexer)) {
        return false;  // 抑制:换行交由 extras 吸收,链式调用跨行延续
      }
      lexer->result_symbol = _NEWLINE;
      return true;
    }
    // 未处于换行处:继续尝试下方的注释/原始字符串分支
  }

  // Nested block comment (extra). blockComment 优先由外部扫描器产出
  // (支持嵌套配对),需自行跳过前导空白;非注释的 '/'(除号、行注释)返回
  // false 交回内部词法。grammar 中保留的正则规则作为内部词法回退。
  if (valid_symbols[BLOCK_COMMENT]) {
    while (iswspace(lexer->lookahead)) {
      skip(lexer);
    }
    if (lexer->lookahead == '/') {
      advance(lexer);
      if (lexer->lookahead == '*') {
        advance(lexer);
        uint32_t depth = 1;
        while (depth > 0 && lexer->lookahead != 0) {
          if (lexer->lookahead == '/') {
            advance(lexer);
            if (lexer->lookahead == '*') {
              advance(lexer);
              depth++;
            }
          } else if (lexer->lookahead == '*') {
            advance(lexer);
            if (lexer->lookahead == '/') {
              advance(lexer);
              depth--;
            }
          } else {
            advance(lexer);
          }
        }
        // 未闭合注释一直吃到 EOF,避免错误级联
        lexer->mark_end(lexer);
        lexer->result_symbol = BLOCK_COMMENT;
        return true;
      }
      return false;
    }
  }

  // Check for raw string opening delimiter
  if (valid_symbols[_MULTI_LINE_RAW_STRING_START]) {
    while (iswspace(lexer->lookahead)) {
      skip(lexer);
    }
    if (lexer->lookahead == '#') {
      return scan_opening_delimiter(lexer, scanner);
    }
  }

  return false;
}
