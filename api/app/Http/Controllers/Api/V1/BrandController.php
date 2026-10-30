<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreBrandRequest;
use App\Http\Requests\Api\V1\UpdateBrandRequest;
use App\Http\Resources\BrandResource;
use App\Models\Brand;
use App\Models\User;
use App\Support\OriginAllowlist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class BrandController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Brand::class);

        /** @var User $user */
        $user = $request->user();

        return BrandResource::collection($user->accessibleBrands()->orderBy('name')->get());
    }

    /**
     * The brand is always created in the user's own organization; an
     * organization_id in the payload is never trusted.
     */
    public function store(StoreBrandRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $brand = $user->primaryMembership->organization->brands()->create([
            ...$request->safe()->only(['name', 'domain', 'greeting']),
            'timezone' => $request->validated('timezone') ?? 'UTC',
            'color' => $request->validated('color') ?? '#4f46e5',
            'allowed_origins' => $this->normalizedOrigins($request->validated('allowed_origins') ?? []),
        ]);

        return BrandResource::make($brand)->response()->setStatusCode(201);
    }

    public function update(UpdateBrandRequest $request, Brand $brand): BrandResource
    {
        Gate::authorize('update', $brand);

        $data = $request->safe()->only([
            'name',
            'domain',
            'timezone',
            'color',
            'greeting',
            'allowed_origins',
        ]);
        if (array_key_exists('allowed_origins', $data)) {
            $data['allowed_origins'] = $this->normalizedOrigins($data['allowed_origins'] ?? []);
        }

        $brand->fill($data);
        $brand->save();

        return BrandResource::make($brand->refresh());
    }

    /**
     * @param  list<mixed>  $origins
     * @return list<string>
     */
    private function normalizedOrigins(array $origins): array
    {
        return OriginAllowlist::normalizeList(
            $origins,
            (bool) config('widget.allow_localhost_origins', false),
        );
    }
}
