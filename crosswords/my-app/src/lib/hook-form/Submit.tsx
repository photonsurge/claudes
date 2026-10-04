import { Box, Button } from "@mui/material"
import { useFormContext } from "react-hook-form";

import {DebugButton} from "../debug"

interface iPSSubmitProps {
    title: string;
}

const PSSubmit = ({ title }: iPSSubmitProps) => {
    const { formState: { errors },getValues } = useFormContext();


    return <Box sx={{}}>

        <DebugButton data={errors} title="Errors" />

        <DebugButton data={getValues()} title="Data" />

        <Button variant="contained" type="submit" fullWidth title={title}>{title}</Button>

    </Box>

}

export default PSSubmit;