"""VEGA Studio Backend – Phase 8 Board Registry, compatibility check, and project selection."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.config import Settings, settings
from app.models.board import (
    BoardBuildProfile,
    BoardCompatibilityReport,
    BoardListResponse,
    BoardProfile,
    BoardSupportStatus,
    BoardUploadProfile,
    CompatibilityCheckItem,
    CompatibilityStatus,
    ProjectBoardStatusResponse,
    SelectProjectBoardResponse,
    validate_board_id_token,
)
from app.models.project import PROJECT_METADATA_FILENAME
from app.models.sdk import SdkConfig
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    validate_directory_input,
)
from app.services.sdk_service import SdkService, _host_os_name, _resolve_existing_path


class BoardServiceError(Exception):
    """Domain error with HTTP status code for Board Manager operations."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Central board registry catalogue — verified specifications only.
# Future VEGA boards append new BoardProfile definitions cleanly here.
_BOARD_CATALOGUE: Tuple[BoardProfile, ...] = (
    BoardProfile(
        id="VEGA_ARIES_V3",
        name="VEGA ARIES V3",
        vendor="C-DAC",
        family="VEGA",
        status="supported",
        architecture="RISC-V 32-bit",
        core="VEGA ET1031",
        cpu_frequency_mhz=100,
        isa="rv32i_zicsr",
        machine="THEJAS32",
        sram_kb=256,
        sensors=["MPU6050 IMU", "BMP280 Barometer"],
        summary=(
            "C-DAC VEGA ARIES V3 development board powered by the VEGA ET1031 "
            "RISC-V 32-bit core running at 100 MHz with 256 KB SRAM, MPU6050 IMU, "
            "and BMP280 barometer."
        ),
        build=BoardBuildProfile(
            cross_compile_prefix="riscv32-vega-elf",
            expected_arch="rv32i_zicsr",
            expected_machine="THEJAS32",
            build_system="vega-sdk-make",
        ),
        upload=BoardUploadProfile(
            method="vega-xmodem",
            uploader_name="vega_xmodem.py",
            requires_port=True,
            artifact_extensions=[".bin", ".elf", ".hex"],
            command_convention_verified=False,
            notes=(
                "Integrates external VEGA SDK uploader (vega_xmodem.py) over USB-UART serial ports "
                "(e.g. /dev/ttyUSB*, /dev/serial/by-id/*, COM*). Exact CLI flags are inspected via script "
                "AST or configured via adaptable invocation mode because vega_xmodem.py is external to this repository."
            ),
        ),
    ),
)


class BoardService:
    """Provides registry lookup, SDK compatibility validation, and safe board selection."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._projects = ProjectService(self._settings)
        self._sdk = SdkService(self._settings)
        self._boards: Dict[str, BoardProfile] = {
            board.id: board for board in _BOARD_CATALOGUE
        }

    # ------------------------------------------------------------------ #
    # Registry access
    # ------------------------------------------------------------------ #

    def list_boards(self) -> BoardListResponse:
        """Return all registered boards in catalogue order."""
        return BoardListResponse(
            boards=[b.model_copy(deep=True) for b in _BOARD_CATALOGUE]
        )

    def find_board(self, board_id: Optional[str]) -> Optional[BoardProfile]:
        """Lookup a board profile by exact identifier without raising."""
        if not board_id:
            return None
        found = self._boards.get(board_id.strip())
        return found.model_copy(deep=True) if found else None

    def get_board_or_raise(self, raw_board_id: str) -> BoardProfile:
        """Validate board identifier and fetch trusted profile or raise 404/400."""
        try:
            clean_id = validate_board_id_token(raw_board_id)
        except ValueError as exc:
            raise BoardServiceError(str(exc), 400) from exc

        board = self.find_board(clean_id)
        if board is None:
            raise BoardServiceError(
                f"Board target '{clean_id}' is not registered or unsupported.",
                404,
            )
        return board

    # ------------------------------------------------------------------ #
    # SDK compatibility evaluation
    # ------------------------------------------------------------------ #

    def validate_compatibility(
        self,
        board: BoardProfile,
        sdk_config: Optional[SdkConfig] = None,
    ) -> BoardCompatibilityReport:
        """Evaluate board compatibility against configured/discovered SDK without mutating state."""
        base_cfg = sdk_config or self._sdk.get_config_state().config
        discovery = self._sdk.discover_environment(
            config_hint=base_cfg, apply_to_config=False
        )
        eff = discovery.suggested_config
        host_os = _host_os_name()

        checks: List[CompatibilityCheckItem] = []
        warnings: List[str] = []
        issues: List[str] = []

        # 1. Registry status
        board_support: BoardSupportStatus = board.status
        if board_support == "supported":
            checks.append(
                CompatibilityCheckItem(
                    id="board_support",
                    label="Board Support Status",
                    status="compatible",
                    detail=f"{board.name} is a verified supported VEGA Studio target.",
                )
            )
        else:
            msg = f"Board '{board.name}' has support status '{board_support}'."
            warnings.append(msg)
            checks.append(
                CompatibilityCheckItem(
                    id="board_support",
                    label="Board Support Status",
                    status="warning",
                    detail=msg,
                )
            )

        # 2. SDK directory
        sdk_path = _resolve_existing_path(eff.sdk_root)
        if sdk_path and sdk_path.is_dir():
            checks.append(
                CompatibilityCheckItem(
                    id="sdk_root",
                    label="VEGA SDK Installation",
                    status="compatible",
                    detail=f"SDK directory verified at {sdk_path}.",
                )
            )
        else:
            msg = "VEGA SDK directory is missing or unconfigured. Configure SDK paths in SDK Doctor."
            issues.append(msg)
            checks.append(
                CompatibilityCheckItem(
                    id="sdk_root",
                    label="VEGA SDK Installation",
                    status="incompatible",
                    detail=msg,
                )
            )

        # 3. Expected ISA / Architecture alignment
        if eff.target_arch == board.build.expected_arch:
            checks.append(
                CompatibilityCheckItem(
                    id="isa_match",
                    label="ISA Architecture Alignment",
                    status="compatible",
                    detail=f"Configured SDK architecture matches board ISA ({board.isa}).",
                )
            )
        else:
            msg = (
                f"Configured SDK architecture '{eff.target_arch}' differs from board ISA '{board.isa}'."
            )
            issues.append(msg)
            checks.append(
                CompatibilityCheckItem(
                    id="isa_match",
                    label="ISA Architecture Alignment",
                    status="incompatible",
                    detail=msg,
                )
            )

        # 4. Machine identifier alignment
        if eff.target_machine == board.build.expected_machine:
            checks.append(
                CompatibilityCheckItem(
                    id="machine_match",
                    label="Machine Target Alignment",
                    status="compatible",
                    detail=f"Configured SDK machine matches '{board.machine}'.",
                )
            )
        else:
            msg = (
                f"Configured SDK machine '{eff.target_machine}' differs from board target '{board.machine}'."
            )
            issues.append(msg)
            checks.append(
                CompatibilityCheckItem(
                    id="machine_match",
                    label="Machine Target Alignment",
                    status="incompatible",
                    detail=msg,
                )
            )

        # 5. Cross-compile prefix & compiler
        expected_prefix = board.build.cross_compile_prefix
        if eff.cross_compile_prefix == expected_prefix:
            compiler_path = _resolve_existing_path(eff.compiler_path)
            if compiler_path and compiler_path.is_file():
                checks.append(
                    CompatibilityCheckItem(
                        id="toolchain_compiler",
                        label="Cross-Compiler Prefix & Binary",
                        status="compatible",
                        detail=f"Located {compiler_path.name} matching prefix '{expected_prefix}'.",
                    )
                )
            else:
                msg = (
                    f"Cross-compiler '{expected_prefix}-gcc' was not found on this {host_os.title()} host."
                )
                if host_os == "windows":
                    warnings.append(msg)
                    checks.append(
                        CompatibilityCheckItem(
                            id="toolchain_compiler",
                            label="Cross-Compiler Prefix & Binary",
                            status="warning",
                            detail=f"{msg} Native compilation targets Ubuntu/Linux.",
                        )
                    )
                else:
                    issues.append(msg)
                    checks.append(
                        CompatibilityCheckItem(
                            id="toolchain_compiler",
                            label="Cross-Compiler Prefix & Binary",
                            status="incompatible",
                            detail=msg,
                        )
                    )
        else:
            msg = (
                f"Configured prefix '{eff.cross_compile_prefix}' does not match expected '{expected_prefix}'."
            )
            issues.append(msg)
            checks.append(
                CompatibilityCheckItem(
                    id="toolchain_compiler",
                    label="Cross-Compiler Prefix & Binary",
                    status="incompatible",
                    detail=msg,
                )
            )

        overall: CompatibilityStatus = (
            "incompatible" if issues else ("warning" if warnings else "compatible")
        )
        return BoardCompatibilityReport(
            board_id=board.id,
            board_name=board.name,
            status=overall,
            compatible=len(issues) == 0,
            checks=checks,
            warnings=warnings,
            issues=issues,
        )

    # ------------------------------------------------------------------ #
    # Active project board inspection & assignment
    # ------------------------------------------------------------------ #

    def get_project_board_status(
        self, raw_project_dir: str
    ) -> ProjectBoardStatusResponse:
        """Inspect active project's target metadata and match against Board Registry."""
        try:
            project_path = validate_directory_input(
                raw_project_dir, label="Project directory"
            )
            if not project_path.exists() or not project_path.is_dir():
                raise BoardServiceError(
                    f"Project directory '{project_path}' does not exist.", 404
                )
            metadata, _, warnings, _ = self._projects._inspect_project_directory(
                project_path
            )
        except ProjectServiceError as exc:
            raise BoardServiceError(exc.message, exc.status_code) from exc

        board_id = metadata.target.board
        profile = self.find_board(board_id) if board_id else None
        supported = profile is not None
        compat = self.validate_compatibility(profile) if profile is not None else None

        return ProjectBoardStatusResponse(
            project_dir=str(project_path),
            selected_board_id=board_id,
            board_supported=supported,
            board=profile,
            project_target=metadata.target,
            compatibility=compat,
            warnings=warnings,
        )

    def select_project_board(
        self, raw_project_dir: str, raw_board_id: str
    ) -> SelectProjectBoardResponse:
        """Persist a verified board profile selection into the project's vega-project.json."""
        board = self.get_board_or_raise(raw_board_id)

        try:
            project_path = validate_directory_input(
                raw_project_dir, label="Project directory"
            )
            if not project_path.exists() or not project_path.is_dir():
                raise BoardServiceError(
                    f"Project directory '{project_path}' does not exist.", 404
                )
            # Ensure project metadata & directory are valid before modifying
            metadata, _, _, _ = self._projects._inspect_project_directory(
                project_path
            )
        except ProjectServiceError as exc:
            raise BoardServiceError(exc.message, exc.status_code) from exc

        meta_path = (project_path / PROJECT_METADATA_FILENAME).resolve(strict=True)
        if meta_path.parent != project_path or not meta_path.is_file():
            raise BoardServiceError(
                f"Invalid '{PROJECT_METADATA_FILENAME}' path inside project.", 400
            )

        try:
            raw_obj = json.loads(meta_path.read_text(encoding="utf-8"))
            if not isinstance(raw_obj, dict):
                raise BoardServiceError(
                    f"Malformed '{PROJECT_METADATA_FILENAME}' root JSON object.",
                    422,
                )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BoardServiceError(
                f"Unable to read '{PROJECT_METADATA_FILENAME}': {exc}", 400
            ) from exc

        previous_board = metadata.target.board
        raw_obj["target"] = {
            "board": board.id,
            "arch": board.isa,
            "machine": board.machine,
        }
        raw_obj["updatedAt"] = _utc_now()
        serialized = json.dumps(raw_obj, indent=2) + "\n"

        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=project_path,
                prefix=".vega-meta-",
                suffix=".tmp",
                delete=False,
            ) as handle:
                tmp_path = Path(handle.name)
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, meta_path)
            tmp_path = None
        except PermissionError as exc:
            raise BoardServiceError(
                f"Permission denied updating '{PROJECT_METADATA_FILENAME}': {exc}",
                403,
            ) from exc
        except OSError as exc:
            raise BoardServiceError(
                f"Failed to save board selection to '{PROJECT_METADATA_FILENAME}': {exc}",
                500,
            ) from exc
        finally:
            if tmp_path is not None:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass

        try:
            workspace_summary = self._projects.open_project(str(project_path))
        except ProjectServiceError as exc:
            raise BoardServiceError(exc.message, exc.status_code) from exc

        board_status = self.get_project_board_status(str(project_path))
        change_note = (
            f"Switched project target board from '{previous_board}' to '{board.name}' ({board.id})."
            if previous_board and previous_board != board.id
            else f"Selected target board '{board.name}' ({board.id}) for '{metadata.name}'."
        )

        return SelectProjectBoardResponse(
            ok=True,
            workspace=workspace_summary,
            board_status=board_status,
            message=change_note,
        )


def get_board_service() -> BoardService:
    """FastAPI dependency returning a BoardService configured from settings."""
    return BoardService(settings)
