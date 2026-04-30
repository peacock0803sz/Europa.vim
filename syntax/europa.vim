if exists('b:current_syntax')
  finish
endif

syntax match EuropaCellBoundary /^━\+$/
syntax match EuropaCellHeader   /^## \[[^]]\+\] [A-Za-z0-9_-]\+$/

highlight default link EuropaCellBoundary Comment
highlight default link EuropaCellHeader   Comment

let b:current_syntax = 'europa'
