import { Box, FormControl, FormHelperText, InputLabel, MenuItem, Select, SelectProps } from "@mui/material";
import { useFormContext, Controller } from "react-hook-form"
import { fieldHolder } from "./general";
import { getFieldError } from "./getFieldError";


interface iSelectFieldProps {
    label: string;
    name: string;
    helperText: string;
    options: {
        value: string | number,
        label: string;
    }[]
}


const PSSelectField = ({ label, name, helperText, options }: iSelectFieldProps) => {

    const { control, formState: { errors }, } = useFormContext();



    return <Controller
        name={name}
        control={control}
        render={(thing) => {
            const labelID = name.replaceAll('.', '_').replaceAll('[', '').replaceAll(']', '')


            const { message, hasError } = getFieldError(errors, name);
            const hText: string = message ?? helperText;
            const errorBool: boolean = hasError;


            const textFieldProps: SelectProps = {
                value: thing.field.value ? thing.field.value : '',
                onChange: (event) => {
                    thing.field.onChange(event.target.value);
                },
                labelId: labelID,
                error:errorBool,
                label,
            }

            return <Box sx={{ ...fieldHolder }}>
                <FormControl fullWidth error={errorBool}>
                    <InputLabel id={labelID}>{label}</InputLabel>
                    <Select
                        {...textFieldProps}
                    >
                        {options.map((opt, iOpt) => <MenuItem key={iOpt} value={opt.value}>{opt.label}</MenuItem>)}

                    </Select>
                    <FormHelperText>{hText}</FormHelperText>
                </FormControl>

            </Box>

        }}


    />
}


export default PSSelectField;