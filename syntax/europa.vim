if exists('b:current_syntax')
  finish
endif

syntax match EuropaCellBoundary /^━\+$/
syntax match EuropaCellHead     /^\[.\{1,3\}\] ─\+/

highlight default link EuropaCellBoundary Comment
highlight default link EuropaCellHead     Statement

let b:current_syntax = 'europa'
