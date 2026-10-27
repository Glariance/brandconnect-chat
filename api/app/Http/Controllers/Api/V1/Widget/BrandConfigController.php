<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Http\Controllers\Controller;
use App\Http\Resources\WidgetConfigResource;
use App\Models\Brand;

class BrandConfigController extends Controller
{
    public function __invoke(string $publicId): WidgetConfigResource
    {
        return WidgetConfigResource::make(Brand::query()->where('public_id', $publicId)->firstOrFail());
    }
}
