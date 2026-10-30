<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreSavedReplyRequest;
use App\Http\Requests\Api\V1\UpdateSavedReplyRequest;
use App\Http\Resources\SavedReplyResource;
use App\Models\Brand;
use App\Models\SavedReply;
use App\Models\User;
use App\Support\SavedReplyShortcut;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class SavedReplyController extends Controller
{
    /**
     * List saved replies for management (includes inactive/archived when requested)
     * or composer resolution for a brand (active only, brand overrides org).
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', SavedReply::class);

        /** @var User $user */
        $user = $request->user();
        $orgId = $user->primaryMembership?->organization_id;
        abort_if($orgId === null, 403, 'No organization membership.');

        $query = SavedReply::query()
            ->with('brand')
            ->where('organization_id', $orgId);

        if ($request->boolean('composer') && $request->filled('brand_id')) {
            $brand = Brand::query()->findOrFail((int) $request->integer('brand_id'));
            abort_unless($user->canAccessBrand($brand), 403, 'You do not have access to this brand.');
            abort_unless((int) $brand->organization_id === (int) $orgId, 403);

            $rows = SavedReply::query()
                ->with('brand')
                ->forComposerBrand($brand->organization, $brand)
                ->orderBy('shortcut')
                ->get();

            $resolved = SavedReply::resolveConflicts($rows);

            return SavedReplyResource::collection(collect($resolved));
        }

        if (! $request->boolean('include_archived')) {
            $query->whereNull('archived_at');
        }

        if ($request->filled('brand_id')) {
            $brandId = (int) $request->integer('brand_id');
            abort_unless(
                $user->accessibleBrands()->whereKey($brandId)->exists(),
                403,
                'You do not have access to this brand.',
            );
            $query->where(function ($q) use ($brandId): void {
                $q->whereNull('brand_id')->orWhere('brand_id', $brandId);
            });
        }

        if ($request->filled('q')) {
            $q = '%'.str_replace(['%', '_'], ['\\%', '\\_'], (string) $request->input('q')).'%';
            $query->where(function ($builder) use ($q): void {
                $builder->where('title', 'like', $q)
                    ->orWhere('shortcut', 'like', $q)
                    ->orWhere('body', 'like', $q);
            });
        }

        $query->orderByDesc('updated_at');

        return SavedReplyResource::collection($query->limit(200)->get());
    }

    public function store(StoreSavedReplyRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $orgId = $user->primaryMembership?->organization_id;
        abort_if($orgId === null, 403);

        $brandId = $request->filled('brand_id') ? (int) $request->input('brand_id') : null;

        $reply = SavedReply::query()->create([
            'organization_id' => $orgId,
            'brand_id' => $brandId,
            'scope_key' => SavedReplyShortcut::scopeKey($brandId),
            'created_by' => $user->id,
            'title' => $request->validated('title'),
            'shortcut' => SavedReplyShortcut::normalize((string) $request->validated('shortcut')),
            'body' => $request->validated('body'),
            'is_active' => $request->boolean('is_active', true),
        ]);

        return SavedReplyResource::make($reply->load('brand'))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateSavedReplyRequest $request, SavedReply $savedReply): SavedReplyResource
    {
        $data = $request->validated();
        if (array_key_exists('shortcut', $data)) {
            $data['shortcut'] = SavedReplyShortcut::normalize((string) $data['shortcut']);
        }
        if (array_key_exists('brand_id', $data) || array_key_exists('shortcut', $data)) {
            $brandId = array_key_exists('brand_id', $data)
                ? ($data['brand_id'] !== null ? (int) $data['brand_id'] : null)
                : $savedReply->brand_id;
            $data['brand_id'] = $brandId;
            $data['scope_key'] = SavedReplyShortcut::scopeKey($brandId);
        }

        $savedReply->fill($data);
        $savedReply->save();

        return SavedReplyResource::make($savedReply->fresh()->load('brand'));
    }

    /**
     * Archive (soft-delete) a saved reply so its shortcut can be reused.
     */
    public function destroy(SavedReply $savedReply): JsonResponse
    {
        Gate::authorize('delete', $savedReply);

        $savedReply->forceFill([
            'is_active' => false,
            'archived_at' => $savedReply->archived_at ?? now(),
        ])->save();

        return response()->json(['data' => null], 200);
    }
}
