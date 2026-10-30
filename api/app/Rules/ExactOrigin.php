<?php

namespace App\Rules;

use App\Support\OriginAllowlist;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use InvalidArgumentException;

class ExactOrigin implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('The :attribute must be a string origin.');

            return;
        }

        try {
            OriginAllowlist::normalize(
                $value,
                (bool) config('widget.allow_localhost_origins', false),
            );
        } catch (InvalidArgumentException $e) {
            $fail($e->getMessage());
        }
    }
}
