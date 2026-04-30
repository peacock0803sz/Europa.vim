if exists('b:current_syntax')
  finish
endif

syntax match EuropaCellBoundary /^━\+$/
syntax match EuropaCellHead     /^## \[[^]]\+\] [A-Za-z0-9_-]\+$/

highlight default link EuropaCellBoundary Comment
highlight default link EuropaCellHead     Statement

let b:current_syntax = 'europa'
