<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Http\Controllers\Controller;
use App\Http\Resources\VisitorSessionResource;
use App\Models\Brand;
use App\Models\Visitor;
use App\Models\VisitorSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class VisitorSessionController extends Controller
{
    /**
     * Every session starts a fresh anonymous visitor; a public brand ID alone
     * never grants access to existing conversations.
     */
    public function store(string $publicId): JsonResponse
    {
        $brand = Brand::query()->where('public_id', $publicId)->firstOrFail();

        $visitor = $brand->visitors()->create();

        return VisitorSessionResource::make(VisitorSession::issueFor($visitor))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Revoke the bearer token used for this request.
     */
    public function destroy(Request $request): Response
    {
        /** @var Visitor $visitor */
        $visitor = $request->user();

        $visitor->currentSession()?->revoke();

        return response()->noContent();
    }
}
